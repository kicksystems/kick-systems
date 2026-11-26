-- LOCAL ONLY. A copy of the part of migration 0003_fada (applied to Supabase by the Fada robot project)
-- that the Shot Tracker builds on, so local tests run against the same shape. Never run this on Supabase.
create type public.fada_status_role as enum ('in_progress','internal_review','adjustments','approved');
alter table public.statuses add column fada_role public.fada_status_role;
alter table public.projects add column discord_notify boolean not null default false,
  add column discord_admin_channel_id text, add column discord_artist_channel_id text,
  add column report_owner_id uuid references public.profiles(id);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete set null,
  code text,
  artist_id uuid references public.profiles(id) on delete set null,
  status_id uuid references public.statuses(id) on delete set null,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (project_id, episode_id, code)
);
create table public.shot_status_history (
  id bigint generated always as identity primary key,
  shot_id uuid not null references public.shots(id) on delete cascade,
  from_status_id uuid references public.statuses(id) on delete set null,
  to_status_id uuid references public.statuses(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create table public.fada_events (
  id bigint generated always as identity primary key,
  project_id uuid, shot_id uuid, kind text, payload jsonb, created_at timestamptz not null default now(),
  processed_at timestamptz, attempts int not null default 0, last_error text
);

create or replace function public.tg_shots_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  if auth.uid() is null or public.can_manage_project(new.project_id) then return new; end if;
  if old.artist_id is distinct from auth.uid() then raise exception 'Sem permissão para alterar este shot'; end if;
  if (new.project_id, new.episode_id, new.code, new.artist_id, new.due_date)
     is distinct from (old.project_id, old.episode_id, old.code, old.artist_id, old.due_date) then
    raise exception 'Artistas só podem alterar o status';
  end if;
  return new;
end $$;
create or replace function public.tg_shots_status_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_role public.fada_status_role; v_notify boolean; v_from uuid := case when tg_op = 'UPDATE' then old.status_id end;
begin
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id then return new; end if;
  insert into public.shot_status_history(shot_id, from_status_id, to_status_id, changed_by) values (new.id, v_from, new.status_id, auth.uid());
  select fada_role into v_role from public.statuses where id = new.status_id;
  select discord_notify into v_notify from public.projects where id = new.project_id;
  if coalesce(v_notify, false) and v_role in ('internal_review','adjustments') then
    insert into public.fada_events(project_id, shot_id, kind, payload)
    values (new.project_id, new.id, case v_role when 'internal_review' then 'ready_for_review' else 'adjustments_needed' end,
            jsonb_build_object('changed_by', auth.uid(), 'from_status_id', v_from, 'to_status_id', new.status_id));
  end if;
  return new;
end $$;
create trigger shots_guard before update on public.shots for each row execute function public.tg_shots_guard();
create trigger shots_status_log after insert or update of status_id on public.shots for each row execute function public.tg_shots_status_log();

alter table public.shots enable row level security;
alter table public.shot_status_history enable row level security;
create policy shots_read on public.shots for select to authenticated using (can_view_project(project_id));
create policy shots_manage on public.shots for all to authenticated using (can_manage_project(project_id)) with check (can_manage_project(project_id));
create policy shots_artist_update on public.shots for update to authenticated using (artist_id = auth.uid()) with check (artist_id = auth.uid());
create policy shot_history_read on public.shot_status_history for select to authenticated
  using (exists (select 1 from shots s where s.id = shot_status_history.shot_id and can_view_project(s.project_id)));
grant select, insert, update, delete on public.shots, public.shot_status_history to authenticated;
