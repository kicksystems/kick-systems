-- Kick Systems: stage 3. Shot count history, checklists, artist availability and contacts.
-- The Fada reminders use the robot's own table (public.reminders, migration 0003_fada); nothing of it is changed here.

-- ───────────────────────── Shot count history ─────────────────────────
-- The number of shots of an episode is its number of rows. Every time a row is added or removed
-- the new count is written here, with who did it and when. Imports write one line per run.
create table if not exists public.tracker_count_history (
  id bigint generated always as identity primary key,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  shots_before int,
  shots_after int not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text not null,
  note text,
  changed_at timestamptz not null default now()
);
create index if not exists tracker_count_history_ep on public.tracker_count_history(episode_id, changed_at desc);

create or replace function public.tg_tracker_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ep uuid := coalesce(new.episode_id, old.episode_id);
  n int;
begin
  if current_setting('kick.bulk_import', true) = 'on' then return null; end if;
  select count(*) into n from public.tracker_shots where episode_id = ep;
  insert into public.tracker_count_history (episode_id, shots_before, shots_after, changed_by, changed_by_name, note)
  values (ep, case when tg_op = 'INSERT' then n - 1 else n + 1 end, n, auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'System'),
          case when tg_op = 'INSERT' then 'Shot added: ' || coalesce(nullif(new.shot_num, ''), 'no number')
               else 'Shot removed: ' || coalesce(nullif(old.shot_num, ''), 'no number') end);
  return null;
end $$;
create trigger tracker_count after insert or delete on public.tracker_shots
for each row execute function public.tg_tracker_count();

alter table public.tracker_count_history enable row level security;
create policy count_history_read on public.tracker_count_history for select to authenticated
  using (public.can_view_episode_page(episode_id, 'shot_tracker'));

-- ───────────────────────── Checklists ─────────────────────────
-- Rules every artist must follow. project_id null = universal (every project).
-- Each rule has phrases in Portuguese; one rule and one phrase are drawn every day on the artist's Home.
create table if not exists public.checklist_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  rule text not null,
  phrases text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.checklist_rules enable row level security;
create policy checklist_read on public.checklist_rules for select to authenticated
  using (project_id is null or public.can_view_project(project_id));
create policy checklist_manage on public.checklist_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── Artist Management ─────────────────────────
create table if not exists public.artist_availability (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('Full Time', 'Part Time', 'Offline', 'Dr. Appointment', 'School Adapt')),
  note text not null default '',
  start_date date not null,
  days int not null default 1 check (days between 0 and 366),
  created_at timestamptz not null default now()
);
create index if not exists artist_availability_person on public.artist_availability(person_id, start_date);

-- Contacts stay out of profiles, which every logged-in person can read.
create table if not exists public.artist_contacts (
  person_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null default '',
  runway text not null default '',
  portfolio text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.artist_availability enable row level security;
alter table public.artist_contacts enable row level security;
create policy availability_admin on public.artist_availability for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy contacts_admin on public.artist_contacts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── Grants ─────────────────────────
revoke all on public.tracker_count_history, public.checklist_rules, public.artist_availability, public.artist_contacts from anon;
grant select on public.tracker_count_history to authenticated;
grant select, insert, update, delete on public.checklist_rules, public.artist_availability, public.artist_contacts to authenticated;
revoke execute on function public.tg_tracker_count() from public, anon, authenticated;

-- Starting point of the history: the import of Nov 25, 2026.
insert into public.tracker_count_history (episode_id, shots_before, shots_after, changed_by_name, note, changed_at)
select e.id, null, count(s.id), 'Import', 'Imported from Superhuman Docs', min(s.created_at)
  from public.episodes e join public.tracker_shots s on s.episode_id = e.id
 where not exists (select 1 from public.tracker_count_history h where h.episode_id = e.id)
 group by e.id;
