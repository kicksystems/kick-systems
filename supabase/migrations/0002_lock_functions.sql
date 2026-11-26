-- Functions are not callable without login. Trigger functions are not callable by anyone directly.
revoke execute on function public.my_type(), public.is_admin(), public.is_member(uuid),
  public.can_view_project(uuid), public.can_manage_project(uuid), public.can_view_page(uuid),
  public.copy_project(uuid, text, text), public.tg_episode_pages(), public.tg_profiles_guard()
  from public, anon;
revoke execute on function public.tg_episode_pages(), public.tg_profiles_guard() from authenticated;
-- Signed-in users need the helpers, because the access rules call them.
grant execute on function public.my_type(), public.is_admin(), public.is_member(uuid),
  public.can_view_project(uuid), public.can_manage_project(uuid), public.can_view_page(uuid),
  public.copy_project(uuid, text, text) to authenticated;
