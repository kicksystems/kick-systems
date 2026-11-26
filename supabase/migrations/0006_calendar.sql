-- Kick Systems: stage 5. The production calendar (RegiStar Schedule rebuilt inside Kick Systems).
-- One calendar per project. Access comes from the project: admins and the project's director edit,
-- artists and observers read, clients do not see the calendar.

create or replace function public.can_view_calendar(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_project(p) and coalesce(public.my_type() <> 'client', false)
$$;

-- Settings: working days, categories and the preparation deadline rule.
create table if not exists public.calendar_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  name text not null default 'Calendar',
  working_days int[] not null default '{1,2,3,4,5}',
  prep_category text default 'recre',             -- events of this category get a preparation deadline
  prep_lead_days int not null default 1 check (prep_lead_days between 0 and 30),
  prep_name text not null default 'RECRE DUE, EDIT, LAST LOOKS',
  categories jsonb not null default '[]',
  revision int not null default 0,
  updated_at timestamptz not null default now()
);

-- Source & rules: admins only.
create table if not exists public.calendar_source (
  project_id uuid primary key references public.projects(id) on delete cascade,
  source jsonb,                                    -- {filename, sheet, rangeStart, rangeEnd, importedAt}
  team_rules text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  episode text not null,
  category text not null,
  title text not null,
  date date not null check (date between '2020-01-01' and '2100-12-31'),
  stage text,
  ripple_linked boolean not null default true,
  origin text not null default 'manual' check (origin in ('import', 'manual')),
  source_label text not null default '',
  source_cells text[] not null default '{}',
  prep_date date,                                  -- null = the automatic date (working days before)
  prep_hidden boolean not null default false,
  deleted_at timestamptz,
  source_ref text unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_project on public.calendar_events(project_id, date) where deleted_at is null;

-- Every change, with the exact rows before and after, so Undo restores the state instead of recalculating it.
create table if not exists public.calendar_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  kind text not null check (kind in ('move', 'create', 'delete', 'prepdel', 'undo', 'import')),
  summary text not null default '',
  rows_before jsonb not null default '[]',
  rows_after jsonb not null default '[]',
  changes jsonb not null default '[]',
  result_revision int not null,
  undo_of uuid,
  created_at timestamptz not null default now()
);
create index if not exists calendar_changes_project on public.calendar_changes(project_id, result_revision desc);

-- Read-only calendar feeds (ICS). The secret link is shown once; only its hash is stored.
create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  categories text[] not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.calendar_settings enable row level security;
alter table public.calendar_source enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_changes enable row level security;
alter table public.calendar_feeds enable row level security;

create policy cal_settings_read on public.calendar_settings for select to authenticated using (public.can_view_calendar(project_id));
create policy cal_settings_write on public.calendar_settings for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy cal_source_admin on public.calendar_source for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cal_events_read on public.calendar_events for select to authenticated using (public.can_view_calendar(project_id));
create policy cal_events_write on public.calendar_events for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy cal_changes_read on public.calendar_changes for select to authenticated using (public.can_manage_project(project_id));
create policy cal_changes_write on public.calendar_changes for insert to authenticated with check (public.can_manage_project(project_id));
create policy cal_feeds_own on public.calendar_feeds for all to authenticated
  using (owner_id = auth.uid() and public.can_view_calendar(project_id))
  with check (owner_id = auth.uid() and public.can_view_calendar(project_id));

grant select, insert, update, delete on public.calendar_settings, public.calendar_source, public.calendar_events, public.calendar_feeds to authenticated;
grant select, insert on public.calendar_changes to authenticated;
grant execute on function public.can_view_calendar(uuid) to authenticated;
