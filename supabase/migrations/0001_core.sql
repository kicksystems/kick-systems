-- Kick Systems: core schema (stage 1)
-- Users, projects, members, episodes, pages, workflow (statuses) and the access rules.
-- Access rules live in the database (row level security), so the app cannot bypass them.

-- ───────────────────────── Types ─────────────────────────
create type public.user_type as enum ('admin', 'director', 'artist', 'client', 'observer');
create type public.page_kind as enum ('shot_tracker', 'visual_guide', 'doc', 'reports', 'checklist');

-- ───────────────────────── Tables ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  user_type public.user_type not null default 'artist',
  discord_user_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  description text,
  uses_episodes boolean not null default true,
  copied_from uuid references public.projects(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,                 -- e.g. "309"
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, code)
);

-- Workflow: the statuses of a project, in order.
create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  color text not null default '#9ca3af' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order int not null,
  is_initial boolean not null default false,       -- new shots start here
  counts_as_done boolean not null default false,   -- counts in the progress bar
  unique (project_id, name)
);
create unique index statuses_one_initial on public.statuses(project_id) where is_initial;

-- Which user types (besides admins and directors, who can set any status)
-- may move a shot INTO this status.
create table public.status_permissions (
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_type public.user_type not null,
  primary key (status_id, user_type)
);

-- Pages every new episode receives (e.g. Shot Tracker, Visual Guides).
create table public.episode_page_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  kind public.page_kind not null,
  visible_to public.user_type[] not null default '{}',
  sort_order int not null default 0,
  unique (project_id, title)
);

-- Pages: project level (episode_id null) or episode level.
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  title text not null,
  kind public.page_kind not null default 'doc',
  visible_to public.user_type[] not null default '{}',
  body text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index pages_project on public.pages(project_id);
create index pages_episode on public.pages(episode_id);

-- Extra access to one page for one person (e.g. a client who should see only one page).
create table public.page_grants (
  page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (page_id, user_id)
);

-- ───────────────────────── Helper functions ─────────────────────────
-- security definer so they can read the tables without triggering the policies again.
create or replace function public.my_type() returns public.user_type
language sql stable security definer set search_path = public as $$
  select user_type from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_type() = 'admin', false)
$$;

create or replace function public.is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m
                 join public.profiles pr on pr.id = m.user_id and pr.is_active
                 where m.project_id = p and m.user_id = auth.uid())
$$;

create or replace function public.can_view_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_member(p)
$$;

-- Admins everywhere; directors in the projects they belong to.
create or replace function public.can_manage_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_type() = 'director' and public.is_member(p))
$$;

create or replace function public.can_view_page(pg uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pages p
    where p.id = pg and (
      public.is_admin()
      or (public.is_member(p.project_id) and (
            public.my_type() = 'director'
         or (public.my_type() = 'observer' and p.kind <> 'reports')
         or (p.kind <> 'reports' and public.my_type() = any (p.visible_to))
         or exists (select 1 from public.page_grants g where g.page_id = p.id and g.user_id = auth.uid())
      ))
    )
  )
$$;

-- ───────────────────────── Triggers ─────────────────────────
-- A new episode receives the pages listed in its project's templates.
create or replace function public.tg_episode_pages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pages (project_id, episode_id, title, kind, visible_to, sort_order)
  select new.project_id, new.id, t.title, t.kind, t.visible_to, t.sort_order
  from public.episode_page_templates t where t.project_id = new.project_id;
  return new;
end $$;
create trigger episode_pages after insert on public.episodes
for each row execute function public.tg_episode_pages();

-- Nobody can change their own user type or deactivate themselves by accident.
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.id = auth.uid()
     and (new.user_type is distinct from old.user_type or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own user type or deactivate yourself.';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
for each row execute function public.tg_profiles_guard();

-- ───────────────────────── Copy a project ─────────────────────────
-- Copies the structure (workflow, episode page templates, project pages with content).
-- Does not copy episodes, shots or members.
create or replace function public.copy_project(source uuid, new_name text, new_slug text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create projects.';
  end if;

  insert into public.projects (name, slug, description, uses_episodes, copied_from, created_by)
  select new_name, new_slug, description, uses_episodes, id, auth.uid()
  from public.projects where id = source
  returning id into new_id;
  if new_id is null then raise exception 'Source project not found.'; end if;

  with src as (
    select s.*, gen_random_uuid() as new_status_id from public.statuses s where s.project_id = source
  ), ins as (
    insert into public.statuses (id, project_id, name, color, sort_order, is_initial, counts_as_done)
    select new_status_id, new_id, name, color, sort_order, is_initial, counts_as_done from src
    returning id
  )
  insert into public.status_permissions (status_id, user_type)
  select src.new_status_id, sp.user_type
  from src join public.status_permissions sp on sp.status_id = src.id;

  insert into public.episode_page_templates (project_id, title, kind, visible_to, sort_order)
  select new_id, title, kind, visible_to, sort_order
  from public.episode_page_templates where project_id = source;

  insert into public.pages (project_id, title, kind, visible_to, body, sort_order)
  select new_id, title, kind, visible_to, body, sort_order
  from public.pages where project_id = source and episode_id is null;

  return new_id;
end $$;

-- ───────────────────────── Row level security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.episodes enable row level security;
alter table public.statuses enable row level security;
alter table public.status_permissions enable row level security;
alter table public.episode_page_templates enable row level security;
alter table public.pages enable row level security;
alter table public.page_grants enable row level security;

-- Profiles: everyone logged in sees names (needed for the Artist column and mentions).
-- Only admins create, edit or remove people.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated using (public.is_admin() and id <> auth.uid());

-- Projects
create policy projects_read on public.projects for select to authenticated using (public.can_view_project(id));
create policy projects_admin_insert on public.projects for insert to authenticated with check (public.is_admin());
create policy projects_manage_update on public.projects for update to authenticated using (public.can_manage_project(id)) with check (public.can_manage_project(id));
create policy projects_admin_delete on public.projects for delete to authenticated using (public.is_admin());

-- Members: you see the members of projects you can see. Only admins change membership.
create policy members_read on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy members_admin_write on public.project_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Episodes
create policy episodes_read on public.episodes for select to authenticated using (public.can_view_project(project_id));
create policy episodes_manage on public.episodes for all to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Workflow
create policy statuses_read on public.statuses for select to authenticated using (public.can_view_project(project_id));
create policy statuses_manage on public.statuses for all to authenticated using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy status_perm_read on public.status_permissions for select to authenticated
  using (exists (select 1 from public.statuses s where s.id = status_id and public.can_view_project(s.project_id)));
create policy status_perm_manage on public.status_permissions for all to authenticated
  using (exists (select 1 from public.statuses s where s.id = status_id and public.can_manage_project(s.project_id)))
  with check (exists (select 1 from public.statuses s where s.id = status_id and public.can_manage_project(s.project_id)));

-- Episode page templates: only managers see and change them.
create policy templates_manage on public.episode_page_templates for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Pages
create policy pages_read on public.pages for select to authenticated using (public.can_view_page(id));
create policy pages_manage on public.pages for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Page grants
create policy grants_read on public.page_grants for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.pages p where p.id = page_id and public.can_manage_project(p.project_id)));
create policy grants_admin_write on public.page_grants for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The anonymous role sees nothing.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.copy_project(uuid, text, text) to authenticated;
