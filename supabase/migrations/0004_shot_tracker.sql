-- Kick Systems: stage 2. Shot Tracker, internal notes, status history, Visual Guides.
-- Builds on the tables that migration 0003_fada (Fada robot project) already created on Supabase:
-- shots, shot_status_history, fada_events, statuses.fada_role. Nothing of the robot's is removed;
-- its triggers keep writing the history and the Discord events.
-- Same rule as stage 1: who sees and changes what is decided here, in the database.

-- ───────────────────────── Projects, statuses, episodes: new fields ─────────────────────────
-- uses_episodes = false is the "one Shot Tracker split by scenes" structure (teaser or POC).
alter table public.projects
  add column if not exists type_label text,                              -- e.g. "Teaser / POC"
  add column if not exists scenes text[] not null default '{}',          -- scene order, for projects without episodes
  add column if not exists tracker_columns text[] not null default '{}', -- Shot Tracker columns, in order ('{}' = default set)
  add column if not exists column_labels jsonb not null default '{}';    -- renamed columns, e.g. {"sequence": "Scene"}

alter table public.statuses
  add column if not exists code int,                                     -- the number the team knows (Coda numbering)
  add column if not exists not_a_shot boolean not null default false,    -- Cancelled, Repeat shot / Alt: not counted as shots
  add column if not exists back_to_artist boolean not null default false;-- Adjustments Needed: artists may move the shot on from here

alter table public.episodes
  add column if not exists storyline text,
  add column if not exists header_md text,                               -- the callout on top of the Shot Tracker (links, notes)
  add column if not exists source_ref text unique;                       -- where it was imported from

-- ───────────────────────── Shots (the robot's table, with the Shot Tracker columns) ─────────────────────────
-- code = Shot #. Coda has rows without a Shot # and repeated numbers (alts), so the number cannot be unique.
alter table public.shots drop constraint if exists shots_project_id_episode_id_code_key;
alter table public.shots
  add column if not exists act text,
  add column if not exists sequence text,                 -- "SEQ 3", or the scene name in scene projects
  add column if not exists slate text,
  add column if not exists timecodes text,
  add column if not exists duration text,                 -- as written: "4s", "0:04"
  add column if not exists brief text not null default '',
  add column if not exists boards jsonb not null default '[]',   -- [{"url": "...", "name": "..."}]
  add column if not exists artist_name text,              -- name from the source while the person has no account yet
  add column if not exists artist_email text,             -- links the shot to the account once it exists
  add column if not exists drive_url text,
  add column if not exists director_notes text not null default '',
  add column if not exists showrunner_notes text not null default '',
  add column if not exists elves_notes text not null default '',
  add column if not exists sort_order int not null default 0,
  add column if not exists edited_here boolean not null default false,  -- changed in Kick Systems: a new import does not overwrite it
  add column if not exists source_ref text unique;
create index if not exists shots_episode on public.shots(episode_id, sort_order);
create index if not exists shots_artist on public.shots(artist_id);

-- History: the robot's trigger writes status ids; names are kept too, so the history reads well
-- even after a status is renamed or removed.
alter table public.shot_status_history
  add column if not exists from_name text,
  add column if not exists to_name text,
  add column if not exists changed_by_name text;
create index if not exists shot_history_shot on public.shot_status_history(shot_id, changed_at desc);

-- Internal notes: signed and dated, "(Regis, Nov 23) - text".
create table if not exists public.shot_notes (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  body text not null,
  source_ref text unique,
  created_at timestamptz not null default now()
);
create index if not exists shot_notes_shot on public.shot_notes(shot_id, created_at);

-- Visual Guides: assets by sequence (location, character, prop...), images kept as links for now.
create table if not exists public.guide_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  sequence text not null default '',
  kind text not null default '',
  title text not null default '',
  images jsonb not null default '[]',
  notes text not null default '',
  sort_order int not null default 0,
  source_ref text unique,
  created_at timestamptz not null default now()
);
create index if not exists guide_items_episode on public.guide_items(episode_id, sort_order);

-- ───────────────────────── Helpers ─────────────────────────
-- Can I see a page of this kind in this episode? (Shot Tracker, Visual Guide...)
create or replace function public.can_view_episode_page(ep uuid, k public.page_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pages p where p.episode_id = ep and p.kind = k and public.can_view_page(p.id))
$$;

-- May this person (not an admin or the director) move this shot from its status into target?
-- Only into the statuses ticked for their user type, artists only on their own shots, and only while the shot
-- sits in one of those statuses or in one that goes back to the artist (Adjustments Needed).
create or replace function public.may_move_status(p_artist uuid, p_from uuid, p_to uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_type() is not null
     and exists (select 1 from public.status_permissions where status_id = p_to and user_type = public.my_type())
     and (public.my_type() <> 'artist' or p_artist is not distinct from auth.uid())
     and (p_from is null
          or exists (select 1 from public.status_permissions where status_id = p_from and user_type = public.my_type())
          or exists (select 1 from public.statuses where id = p_from and back_to_artist))
$$;

-- ───────────────────────── Triggers ─────────────────────────
-- Replaces the robot's guard with the full rule set (same behaviour for admins, directors and the import).
-- Artists: only the status of their own shots, and only into the statuses allowed for artists.
-- Clients: only Elves Notes and Showrunner Notes.
create or replace function public.tg_shots_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ignore text[] := array['updated_at', 'edited_here'];
begin
  new.updated_at := now();
  -- System updates (linking a new account to its imported shots) pass untouched.
  if current_setting('kick.system_update', true) = 'on' then
    return new;
  end if;
  if auth.uid() is not null then new.edited_here := true; end if;
  if auth.uid() is null or public.can_manage_project(new.project_id) then
    return new;
  end if;
  if public.my_type() = 'client' then
    if (to_jsonb(new) - (ignore || array['elves_notes', 'showrunner_notes']))
       is distinct from (to_jsonb(old) - (ignore || array['elves_notes', 'showrunner_notes'])) then
      raise exception 'Clients only write in Elves Notes and Showrunner Notes.';
    end if;
    return new;
  end if;
  if old.artist_id is distinct from auth.uid() then
    raise exception 'You can only change your own shots.';
  end if;
  if (to_jsonb(new) - (ignore || array['status_id'])) is distinct from (to_jsonb(old) - (ignore || array['status_id'])) then
    raise exception 'Artists can only change the status.';
  end if;
  if new.status_id is distinct from old.status_id and not public.may_move_status(old.artist_id, old.status_id, new.status_id) then
    raise exception 'You cannot move this shot to that status.';
  end if;
  return new;
end $$;

-- The robot's trigger writes the history row (ids) and the Discord event. This one adds the readable names.
create or replace function public.tg_shot_history_names() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.from_name := coalesce(new.from_name, (select name from public.statuses where id = new.from_status_id));
  new.to_name := coalesce(new.to_name, (select name from public.statuses where id = new.to_status_id));
  new.changed_by_name := coalesce(new.changed_by_name, (select full_name from public.profiles where id = new.changed_by), 'Import');
  return new;
end $$;
drop trigger if exists shot_history_names on public.shot_status_history;
create trigger shot_history_names before insert on public.shot_status_history
for each row execute function public.tg_shot_history_names();

-- A person added later with the same e-mail takes over the shots imported under their name.
create or replace function public.tg_profiles_claim_shots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('kick.system_update', 'on', true);
  update public.shots set artist_id = new.id
   where artist_id is null and artist_email is not null and lower(artist_email) = lower(new.email);
  perform set_config('kick.system_update', 'off', true);
  return new;
end $$;
drop trigger if exists profiles_claim_shots on public.profiles;
create trigger profiles_claim_shots after insert or update of email on public.profiles
for each row execute function public.tg_profiles_claim_shots();

-- ───────────────────────── Actions for people who cannot edit the whole row ─────────────────────────
create or replace function public.set_shot_status(shot uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shots%rowtype;
begin
  select * into s from public.shots where id = shot;
  if s.id is null or s.episode_id is null or not public.can_view_episode_page(s.episode_id, 'shot_tracker') then
    raise exception 'Shot not found.';
  end if;
  if not exists (select 1 from public.statuses where id = target and project_id = s.project_id) then
    raise exception 'Unknown status.';
  end if;
  if not public.can_manage_project(s.project_id) and not public.may_move_status(s.artist_id, s.status_id, target) then
    raise exception 'You cannot move this shot to that status.';
  end if;
  update public.shots set status_id = target where id = shot;
end $$;

create or replace function public.set_client_note(shot uuid, field text, body text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shots%rowtype;
begin
  select * into s from public.shots where id = shot;
  if s.id is null or s.episode_id is null or not public.can_view_episode_page(s.episode_id, 'shot_tracker') then
    raise exception 'Shot not found.';
  end if;
  if not (public.can_manage_project(s.project_id) or public.my_type() = 'client') then
    raise exception 'Only the client and the admins write these notes.';
  end if;
  if field = 'elves_notes' then update public.shots set elves_notes = coalesce(body, '') where id = shot;
  elsif field = 'showrunner_notes' then update public.shots set showrunner_notes = coalesce(body, '') where id = shot;
  else raise exception 'Unknown field.';
  end if;
end $$;

-- ───────────────────────── Row level security ─────────────────────────
alter table public.shot_notes enable row level security;
alter table public.guide_items enable row level security;

-- Shots: whoever sees the episode's Shot Tracker, except clients, who read shots_client (no Artist, no Due date).
drop policy if exists shots_read on public.shots;
create policy shots_read on public.shots for select to authenticated
  using (episode_id is not null and public.can_view_episode_page(episode_id, 'shot_tracker') and public.my_type() <> 'client');
-- shots_manage (admins, directors) and shots_artist_update (own shots; the guard limits it to the status) stay as they are.

-- History: whoever sees the shot (so not clients).
drop policy if exists shot_history_read on public.shot_status_history;
create policy shot_history_read on public.shot_status_history for select to authenticated
  using (exists (select 1 from public.shots s where s.id = shot_id));

-- Internal notes: never for clients. Admins and the director write and remove.
drop policy if exists notes_read on public.shot_notes;
drop policy if exists notes_write on public.shot_notes;
drop policy if exists notes_delete on public.shot_notes;
create policy notes_read on public.shot_notes for select to authenticated
  using (public.my_type() <> 'client' and exists (select 1 from public.shots s where s.id = shot_id));
create policy notes_write on public.shot_notes for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.shots s where s.id = shot_id and public.can_manage_project(s.project_id)));
create policy notes_delete on public.shot_notes for delete to authenticated
  using (exists (select 1 from public.shots s where s.id = shot_id and public.can_manage_project(s.project_id)));

-- Visual Guides
drop policy if exists guide_read on public.guide_items;
drop policy if exists guide_manage on public.guide_items;
create policy guide_read on public.guide_items for select to authenticated
  using (public.can_view_episode_page(episode_id, 'visual_guide'));
create policy guide_manage on public.guide_items for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- What clients see of the Shot Tracker. The view runs with its owner's rights and filters by itself.
create or replace view public.shots_client as
  select id, project_id, episode_id, code, act, sequence, slate, timecodes, duration, brief, boards,
         status_id, drive_url, director_notes, showrunner_notes, elves_notes, sort_order
    from public.shots
   where public.my_type() = 'client' and episode_id is not null
     and public.can_view_episode_page(episode_id, 'shot_tracker');

-- ───────────────────────── Grants ─────────────────────────
revoke all on public.shot_notes, public.guide_items, public.shots_client from anon;
grant select, insert, update, delete on public.shot_notes, public.guide_items to authenticated;
grant select on public.shots_client to authenticated;

revoke execute on function public.can_view_episode_page(uuid, public.page_kind), public.may_move_status(uuid, uuid, uuid),
  public.set_shot_status(uuid, uuid), public.set_client_note(uuid, text, text),
  public.tg_shots_guard(), public.tg_shot_history_names(), public.tg_profiles_claim_shots() from public, anon;
revoke execute on function public.tg_shots_guard(), public.tg_shot_history_names(), public.tg_profiles_claim_shots() from authenticated;
grant execute on function public.can_view_episode_page(uuid, public.page_kind), public.may_move_status(uuid, uuid, uuid),
  public.set_shot_status(uuid, uuid), public.set_client_note(uuid, text, text) to authenticated;
