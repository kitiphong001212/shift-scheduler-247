create table if not exists public.scheduler_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  state_key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, state_key)
);

alter table public.scheduler_state enable row level security;

create policy "Users can read their own scheduler state"
  on public.scheduler_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own scheduler state"
  on public.scheduler_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own scheduler state"
  on public.scheduler_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own scheduler state"
  on public.scheduler_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_scheduler_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scheduler_state_updated_at on public.scheduler_state;
create trigger scheduler_state_updated_at
before update on public.scheduler_state
for each row execute function public.set_scheduler_state_updated_at();

alter publication supabase_realtime add table public.scheduler_state;
