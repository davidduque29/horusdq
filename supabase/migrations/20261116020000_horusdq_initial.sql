-- HorusDQ v1: isolated schema for its own Supabase project.
-- Deploy only on a dedicated HorusDQ project. Never run on Orbit Tasks/TrackVikol.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 2 and 80),
 created_at timestamptz not null default now()
);
create table if not exists public.project_members (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'viewer' check(role in ('viewer','admin')),
 primary key(project_id,user_id)
);
create or replace function private.can_read_project(target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$select exists(select 1 from public.projects p where p.id=target and
 (p.owner_id=auth.uid() or exists(select 1 from public.project_members m where m.project_id=p.id and m.user_id=auth.uid())))$$;
revoke all on function private.can_read_project(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_read_project(uuid) to authenticated;

create table if not exists public.project_integrations (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 provider text not null default 'github' check(provider='github'),
 repo_owner text not null,
 repo_name text not null,
 enabled boolean not null default true,
 unique(repo_owner,repo_name),
 unique(project_id,id)
);
create table if not exists public.workflow_runs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 provider_run_id bigint not null,
 workflow_name text not null,
 branch text,
 status text not null,
 conclusion text,
 source_url text not null,
 updated_at timestamptz not null default now(),
 unique(project_id,provider_run_id)
);
create table if not exists public.deployment_events (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 deployment_id bigint not null,
 state text not null,
 environment text,
 source_url text,
 occurred_at timestamptz not null default now(),
 unique(project_id,deployment_id,state)
);
create table if not exists public.webhook_deliveries (
 delivery_id uuid primary key,
 project_id uuid not null references public.projects(id) on delete cascade,
 event_type text not null,
 received_at timestamptz not null default now()
);
create table if not exists public.notification_preferences (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 success boolean not null default true,
 failure boolean not null default true,
 started boolean not null default false,
 outage boolean not null default true,
 recovery boolean not null default true,
 push_enabled boolean not null default true,
 email_enabled boolean not null default true,
 primary key(project_id,user_id)
);
create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint_hash text not null unique,
 subscription jsonb not null,
 label text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 event_key text not null,
 kind text not null check(kind in ('deployment_success','failure','outage','recovery')),
 channel text not null check(channel in ('push','email')),
 target_key text not null,
 title text not null,
 body text not null,
 source_url text,
 status text not null default 'pending' check(status in ('pending','processing','retry','sent','failed')),
 attempts int not null default 0,
 next_attempt_at timestamptz not null default now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(event_key,recipient_id,channel,target_key)
);
create index if not exists outbox_due on public.notification_outbox(status,next_attempt_at);
create table if not exists public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
 delivered_at timestamptz not null default now(),
 provider_status text not null,
 error_text text
);
create table if not exists public.monitored_services (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 name text not null,
 url text not null check(url ~ '^https://[A-Za-z0-9.-]+/'),
 enabled boolean not null default false,
 interval_minutes integer not null default 5 check(interval_minutes=5),
 created_at timestamptz not null default now()
);
create table if not exists public.health_results (
 id uuid primary key default gen_random_uuid(),
 service_id uuid not null references public.monitored_services(id) on delete cascade,
 checked_at timestamptz not null default now(),
 healthy boolean not null,
 status_code integer,
 latency_ms integer
);
create index if not exists health_by_service on public.health_results(service_id,checked_at desc);
create table if not exists public.incidents (
 id uuid primary key default gen_random_uuid(),
 service_id uuid not null references public.monitored_services(id) on delete cascade,
 started_at timestamptz not null default now(),
 resolved_at timestamptz,
 state text not null default 'open' check(state in ('open','resolved'))
);
create unique index if not exists one_open_incident on public.incidents(service_id) where state='open';

-- Strict row access: backend writers use a protected server-only key.
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_integrations enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.deployment_events enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.monitored_services enable row level security;
alter table public.health_results enable row level security;
alter table public.incidents enable row level security;

create policy "owner reads own projects" on public.projects for select to authenticated
 using(private.can_read_project(id));
create policy "owner creates projects" on public.projects for insert to authenticated
 with check(owner_id=(select auth.uid()));
create policy "owner edits own projects" on public.projects for update to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "owner deletes own projects" on public.projects for delete to authenticated
 using(owner_id=(select auth.uid()));
create policy "members read project membership" on public.project_members for select to authenticated
 using(private.can_read_project(project_id));
create policy "owner manages project membership" on public.project_members for insert to authenticated
 with check(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "owner removes members" on public.project_members for delete to authenticated
 using(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "members read integration" on public.project_integrations for select to authenticated
 using(private.can_read_project(project_id));
create policy "owner adds integration" on public.project_integrations for insert to authenticated
 with check(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "owner modifies integration" on public.project_integrations for update to authenticated
 using(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())))
 with check(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "members read workflow" on public.workflow_runs for select to authenticated using(private.can_read_project(project_id));
create policy "members read deployment" on public.deployment_events for select to authenticated using(private.can_read_project(project_id));
create policy "members read webhook delivery" on public.webhook_deliveries for select to authenticated using(private.can_read_project(project_id));
create policy "own preferences read" on public.notification_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy "own preferences insert" on public.notification_preferences for insert to authenticated
 with check(user_id=(select auth.uid()) and private.can_read_project(project_id));
create policy "own preferences update" on public.notification_preferences for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and private.can_read_project(project_id));
create policy "own push subscription read" on public.push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy "own push subscription insert" on public.push_subscriptions for insert to authenticated with check(user_id=(select auth.uid()));
create policy "own push subscription update" on public.push_subscriptions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "own push subscription delete" on public.push_subscriptions for delete to authenticated using(user_id=(select auth.uid()));
create policy "own notifications read" on public.notification_outbox for select to authenticated using(recipient_id=(select auth.uid()));
create policy "own notification deliveries read" on public.notification_deliveries for select to authenticated
 using(exists(select 1 from public.notification_outbox o where o.id=outbox_id and o.recipient_id=(select auth.uid())));
create policy "members read services" on public.monitored_services for select to authenticated using(private.can_read_project(project_id));
create policy "owner adds service" on public.monitored_services for insert to authenticated
 with check(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "owner updates service" on public.monitored_services for update to authenticated
 using(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())))
 with check(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "members read health" on public.health_results for select to authenticated
 using(exists(select 1 from public.monitored_services s where s.id=service_id and private.can_read_project(s.project_id)));
create policy "members read incidents" on public.incidents for select to authenticated
 using(exists(select 1 from public.monitored_services s where s.id=service_id and private.can_read_project(s.project_id)));

-- Atomic claim: service-role only; prevents duplicate concurrent dispatch.
create or replace function public.claim_notification_batch(batch_limit integer default 25)
returns setof public.notification_outbox
language plpgsql security invoker set search_path=public,pg_temp
as $$
begin
 if current_user <> 'service_role' then raise exception 'forbidden'; end if;
 return query
 with selected as (
  select id from public.notification_outbox
  where (status in ('pending','retry') and next_attempt_at<=now())
     or (status='processing' and claimed_at < now()-interval '10 minutes')
  order by created_at for update skip locked limit least(greatest(batch_limit,1),100)
 )
 update public.notification_outbox o set status='processing',attempts=o.attempts+1,claimed_at=now()
 from selected where o.id=selected.id
 returning o.*;
end; $$;
revoke all on function public.claim_notification_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_batch(integer) to service_role;
