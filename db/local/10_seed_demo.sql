-- LOCAL DEMO DATA. Real names, fake e-mails (@example.test). Not for production.
-- The real users are added by an admin on the Users page.

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001','regis@example.test'),
 ('00000000-0000-0000-0000-000000000002','fernanda@example.test'),
 ('00000000-0000-0000-0000-000000000003','igor@example.test'),
 ('00000000-0000-0000-0000-000000000004','sarah.spillane@example.test'),
 ('00000000-0000-0000-0000-000000000011','hugo@example.test'),
 ('00000000-0000-0000-0000-000000000012','cristianne@example.test'),
 ('00000000-0000-0000-0000-000000000013','sarah.ramos@example.test'),
 ('00000000-0000-0000-0000-000000000021','elves@example.test'),
 ('00000000-0000-0000-0000-000000000031','melina@example.test');

insert into public.profiles (id, email, full_name, user_type, discord_user_id) values
 ('00000000-0000-0000-0000-000000000001','regis@example.test','Regis Terencio','admin',null),
 ('00000000-0000-0000-0000-000000000002','fernanda@example.test','Fernanda Pio','admin',null),
 ('00000000-0000-0000-0000-000000000003','igor@example.test','Igor Martins','admin',null),
 ('00000000-0000-0000-0000-000000000004','sarah.spillane@example.test','Sarah Spillane','director',null),
 ('00000000-0000-0000-0000-000000000011','hugo@example.test','Hugo Benchimol','artist',null),
 ('00000000-0000-0000-0000-000000000012','cristianne@example.test','Cristianne Ly','artist',null),
 ('00000000-0000-0000-0000-000000000013','sarah.ramos@example.test','Sarah Ramos','artist',null),
 ('00000000-0000-0000-0000-000000000021','elves@example.test','Magical Elves (demo)','client',null),
 ('00000000-0000-0000-0000-000000000031','melina@example.test','Melina Salles','observer',null);

-- PEKS project
insert into public.projects (id, name, slug, description, created_by) values
 ('10000000-0000-0000-0000-000000000001','PEKS','peks','Prosecuting Evil with Kelly Siegler','00000000-0000-0000-0000-000000000001');

insert into public.statuses (project_id, name, color, sort_order, is_initial, counts_as_done) values
 ('10000000-0000-0000-0000-000000000001','Not Started','#9ca3af',1,true,false),
 ('10000000-0000-0000-0000-000000000001','In Progress','#3b82f6',2,false,false),
 ('10000000-0000-0000-0000-000000000001','Ready for Internal Approval','#a855f7',3,false,false),
 ('10000000-0000-0000-0000-000000000001','Adjustments Needed','#ef4444',4,false,false),
 ('10000000-0000-0000-0000-000000000001','Approved by Igor','#14b8a6',5,false,false),
 ('10000000-0000-0000-0000-000000000001','Ready for Delivery','#22c55e',6,false,true),
 ('10000000-0000-0000-0000-000000000001','Delivered, used in Fine Cut','#15803d',7,false,false),
 ('10000000-0000-0000-0000-000000000001','ON HOLD','#f59e0b',8,false,false),
 ('10000000-0000-0000-0000-000000000001','Cancelled','#4b5563',9,false,false),
 ('10000000-0000-0000-0000-000000000001','Needs internal discussion','#ec4899',10,false,false),
 ('10000000-0000-0000-0000-000000000001','Needs cleaning','#f97316',11,false,false),
 ('10000000-0000-0000-0000-000000000001','Delivered, used in Rough Cut','#0ea5e9',12,false,false),
 ('10000000-0000-0000-0000-000000000001','Repeat shot / Alt','#8b5cf6',13,false,false);

insert into public.status_permissions (status_id, user_type)
select id, 'artist' from public.statuses
where project_id = '10000000-0000-0000-0000-000000000001'
  and name in ('Not Started','In Progress','Ready for Internal Approval');

insert into public.episode_page_templates (project_id, title, kind, visible_to, sort_order) values
 ('10000000-0000-0000-0000-000000000001','Shot Tracker','shot_tracker','{artist,client}',1),
 ('10000000-0000-0000-0000-000000000001','Visual Guides','visual_guide','{artist,client}',2);

insert into public.pages (project_id, title, kind, visible_to, sort_order) values
 ('10000000-0000-0000-0000-000000000001','Treinamento','doc','{artist}',1),
 ('10000000-0000-0000-0000-000000000001','Templates for Prompting','doc','{artist}',2),
 ('10000000-0000-0000-0000-000000000001','Ferramentas e Arquivos','doc','{artist}',3),
 ('10000000-0000-0000-0000-000000000001','Guidelines de Estilo Visual','doc','{artist}',4),
 ('10000000-0000-0000-0000-000000000001','Admin notes','doc','{}',5),
 ('10000000-0000-0000-0000-000000000001','Reports','reports','{}',6);

insert into public.episodes (project_id, code, is_active) values
 ('10000000-0000-0000-0000-000000000001','309',false),
 ('10000000-0000-0000-0000-000000000001','312',true),
 ('10000000-0000-0000-0000-000000000001','314',true);

insert into public.project_members (project_id, user_id)
select '10000000-0000-0000-0000-000000000001', id from public.profiles
where id <> '00000000-0000-0000-0000-000000000012';  -- Cristianne is only in RAPID DNA in this demo
