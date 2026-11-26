-- Kick Systems: stage 2. Shot Tracker, internal notes, status history, Visual Guides.
-- Modelled on the Shot Trackers in Superhuman Docs (Coda). Its own tables: the Fada robot's
-- shots / shot_status_history (migration 0003_fada) are a different thing and are not touched.
-- Same rule as stage 1: who sees and changes what is decided here, in the database.

-- ───────────────────────── Projects, statuses, episodes: new fields ─────────────────────────
-- uses_episodes = false is the "one Shot Tracker split by scenes" structure (teaser or POC).
alter table public.projects
  add column if not exists type_label text,                                   -- e.g. "Teaser / POC"
  add column if not exists scenes text[] not null default '{}',               -- scene order, for projects without episodes
  add column if not exists tracker_columns text[] not null default '{}',      -- Shot Tracker columns, in order ('{}' = default set)
  add column if not exists column_labels jsonb not null default '{}';         -- renamed columns, e.g. {"sequence": "Scene"}

alter table public.statuses
  add column if not exists code int,                                          -- the number the team knows (Coda numbering)
  add column if not exists not_a_shot boolean not null default false,         -- Cancelled, Repeat shot / Alt: not counted as shots
  add column if not exists back_to_artist boolean not null default false;     -- Adjustments Needed: artists may move the shot on from here

alter table public.episodes
  add column if not exists storyline text,
  add column if not exists header_md text,                                    -- the callout on top of the Shot Tracker (links, notes)
  add column if not exists source_ref text unique;                            -- where it was imported from

do $$ begin
  alter table public.episodes add constraint episodes_id_project unique (id, project_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- ───────────────────────── Shots ─────────────────────────
create table public.tracker_shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  episode_id uuid not null,
  shot_num text not null default '',
  act text,
  sequence text,                       -- "SEQ 3", or the scene name in scene projects
  slate text,
  timecodes text,
  duration text,                       -- as written: "4s", "0:04"
  brief text not null default '',
  boards jsonb not null default '[]',  -- [{"url": "...", "name": "..."}]
  artist_id uuid references public.profiles(id) on delete set null,
  artist_name text,                    -- name from the source while the person has no account yet
  artist_email text,                   -- links the shot to the account once it exists
  status_id uuid references public.statuses(id) on delete set null,
  due_date date,
  drive_url text,
  director_notes text not null default '',
  showrunner_notes text not null default '',
  elves_notes text not null default '',
  new_shots_review text not null default '',   -- Coda: New Shots (Internal review)
  sort_order int not null default 0,
  edited_here boolean not null default false,   -- changed in Kick Systems: a new import does not overwrite it
  source_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (episode_id, project_id) references public.episodes(id, project_id) on delete cascade
);
create index tracker_shots_episode on public.tracker_shots(episode_id, sort_order);
create index tracker_shots_artist on public.tracker_shots(artist_id);

-- Internal notes: signed and dated, "(Regis, Nov 23) - text".
create table public.tracker_notes (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.tracker_shots(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  body text not null,
  source_ref text unique,
  created_at timestamptz not null default now()
);
create index tracker_notes_shot on public.tracker_notes(shot_id, created_at);

-- Full status history. Written by a trigger, never by hand.
create table public.tracker_status_history (
  id bigint generated always as identity primary key,
  shot_id uuid not null references public.tracker_shots(id) on delete cascade,
  from_name text,
  to_name text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index tracker_history_shot on public.tracker_status_history(shot_id, changed_at desc);

-- Visual Guides: assets by sequence (location, character, prop...), images kept as links for now.
create table public.guide_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  episode_id uuid not null,
  sequence text not null default '',
  kind text not null default '',
  title text not null default '',
  images jsonb not null default '[]',
  notes text not null default '',
  sort_order int not null default 0,
  source_ref text unique,
  created_at timestamptz not null default now(),
  foreign key (episode_id, project_id) references public.episodes(id, project_id) on delete cascade
);
create index guide_items_episode on public.guide_items(episode_id, sort_order);

-- ───────────────────────── Helpers ─────────────────────────
-- Can I see a page of this kind in this episode? (Shot Tracker, Visual Guide...)
create or replace function public.can_view_episode_page(ep uuid, k public.page_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pages p where p.episode_id = ep and p.kind = k and public.can_view_page(p.id))
$$;

-- ───────────────────────── Triggers ─────────────────────────
-- Status history, edit marks and updated_at.
create or replace function public.tg_tracker_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  who_name text := (select full_name from public.profiles where id = auth.uid());
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if who is not null then new.edited_here := true; end if;
  end if;
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    insert into public.tracker_status_history (shot_id, from_name, to_name, changed_by, changed_by_name)
    values (new.id,
            case when tg_op = 'UPDATE' then (select name from public.statuses where id = old.status_id) end,
            (select name from public.statuses where id = new.status_id),
            who, coalesce(who_name, 'Import'));
  end if;
  return new;
end $$;
create trigger tracker_track_insert after insert on public.tracker_shots for each row execute function public.tg_tracker_track();
create trigger tracker_track_update before update on public.tracker_shots for each row execute function public.tg_tracker_track();

-- The insert trigger runs AFTER (the row must exist for the history), the update one BEFORE (to set fields).
-- A person added later with the same e-mail takes over the shots imported under their name.
create or replace function public.tg_profiles_claim_tracker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tracker_shots set artist_id = new.id
   where artist_id is null and artist_email is not null and lower(artist_email) = lower(new.email);
  return new;
end $$;
create trigger profiles_claim_tracker after insert or update of email on public.profiles
for each row execute function public.tg_profiles_claim_tracker();

-- ───────────────────────── Actions for people who cannot edit the whole row ─────────────────────────
-- Status change. Admins and directors: any status. Others: only into the statuses ticked for their type,
-- artists only on their own shots, and only while the shot sits in one of those statuses
-- or in a status that goes back to the artist (Adjustments Needed).
create or replace function public.set_shot_status(shot uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.tracker_shots%rowtype;
  t public.user_type := public.my_type();
begin
  select * into s from public.tracker_shots where id = shot;
  if s.id is null or not public.can_view_episode_page(s.episode_id, 'shot_tracker') then
    raise exception 'Shot not found.';
  end if;
  if not exists (select 1 from public.statuses where id = target and project_id = s.project_id) then
    raise exception 'Unknown status.';
  end if;
  if not public.can_manage_project(s.project_id) then
    if t is null or not exists (select 1 from public.status_permissions where status_id = target and user_type = t) then
      raise exception 'You cannot move a shot to this status.';
    end if;
    if t = 'artist' and s.artist_id is distinct from auth.uid() then
      raise exception 'You can only change your own shots.';
    end if;
    if s.status_id is not null
       and not exists (select 1 from public.status_permissions where status_id = s.status_id and user_type = t)
       and not exists (select 1 from public.statuses where id = s.status_id and back_to_artist) then
      raise exception 'This shot is with the admins now.';
    end if;
  end if;
  update public.tracker_shots set status_id = target where id = shot;
end $$;

-- Client notes (Elves Notes, Showrunner Notes).
create or replace function public.set_client_note(shot uuid, field text, body text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.tracker_shots%rowtype;
begin
  select * into s from public.tracker_shots where id = shot;
  if s.id is null or not public.can_view_episode_page(s.episode_id, 'shot_tracker') then
    raise exception 'Shot not found.';
  end if;
  if not (public.can_manage_project(s.project_id) or public.my_type() = 'client') then
    raise exception 'Only the client and the admins write these notes.';
  end if;
  if field = 'elves_notes' then update public.tracker_shots set elves_notes = coalesce(body, '') where id = shot;
  elsif field = 'showrunner_notes' then update public.tracker_shots set showrunner_notes = coalesce(body, '') where id = shot;
  else raise exception 'Unknown field.';
  end if;
end $$;

-- ───────────────────────── Row level security ─────────────────────────
alter table public.tracker_shots enable row level security;
alter table public.tracker_notes enable row level security;
alter table public.tracker_status_history enable row level security;
alter table public.guide_items enable row level security;

-- Shots: everyone who sees the episode's Shot Tracker, except clients, who read shots_client (no Artist, no Due date).
create policy tracker_read on public.tracker_shots for select to authenticated
  using (public.can_view_episode_page(episode_id, 'shot_tracker') and public.my_type() <> 'client');
create policy tracker_manage on public.tracker_shots for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Internal notes: never for clients. Managers write and remove.
create policy tracker_notes_read on public.tracker_notes for select to authenticated
  using (public.my_type() <> 'client' and exists (select 1 from public.tracker_shots s where s.id = shot_id));
create policy tracker_notes_write on public.tracker_notes for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.tracker_shots s where s.id = shot_id and public.can_manage_project(s.project_id)));
create policy tracker_notes_delete on public.tracker_notes for delete to authenticated
  using (exists (select 1 from public.tracker_shots s where s.id = shot_id and public.can_manage_project(s.project_id)));

-- History: read by whoever sees the shot (not clients).
create policy tracker_history_read on public.tracker_status_history for select to authenticated
  using (exists (select 1 from public.tracker_shots s where s.id = shot_id));

-- Visual Guides
create policy guide_read on public.guide_items for select to authenticated
  using (public.can_view_episode_page(episode_id, 'visual_guide'));
create policy guide_manage on public.guide_items for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- What clients see of the Shot Tracker. The view runs with its owner's rights and filters by itself.
create view public.tracker_shots_client as
  select id, project_id, episode_id, shot_num, act, sequence, slate, timecodes, duration, brief, boards,
         status_id, drive_url, director_notes, showrunner_notes, elves_notes, sort_order
    from public.tracker_shots
   where public.my_type() = 'client' and public.can_view_episode_page(episode_id, 'shot_tracker');

-- ───────────────────────── Grants ─────────────────────────
revoke all on public.tracker_shots, public.tracker_notes, public.tracker_status_history, public.guide_items, public.tracker_shots_client from anon;
grant select, insert, update, delete on public.tracker_shots, public.tracker_notes, public.guide_items to authenticated;
grant select on public.tracker_status_history, public.tracker_shots_client to authenticated;

revoke execute on function public.can_view_episode_page(uuid, public.page_kind), public.set_shot_status(uuid, uuid),
  public.set_client_note(uuid, text, text), public.tg_tracker_track(), public.tg_profiles_claim_tracker() from public, anon;
revoke execute on function public.tg_tracker_track(), public.tg_profiles_claim_tracker() from authenticated;
grant execute on function public.can_view_episode_page(uuid, public.page_kind), public.set_shot_status(uuid, uuid),
  public.set_client_note(uuid, text, text) to authenticated;
