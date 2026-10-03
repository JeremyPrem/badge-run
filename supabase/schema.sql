-- Badge Run: saved teams.
-- Paste into Supabase → SQL Editor → New query, and run once. Safe to re-run.

create table if not exists public.teams (
  id          uuid primary key,                        -- generated in the browser so local and cloud copies share an id
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game        text not null check (char_length(game) <= 64),
  name        text not null default 'My team' check (char_length(name) between 1 and 60),
  members     jsonb not null default '[]'::jsonb
              check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 6),
  is_public   boolean not null default false,          -- true = anyone with the share link can read it
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists teams_user_game_idx on public.teams (user_id, game);

-- Row-level security: the publishable key in the page can only reach rows these policies allow.
alter table public.teams enable row level security;

drop policy if exists "Read own teams" on public.teams;
create policy "Read own teams" on public.teams
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Read shared teams" on public.teams;
create policy "Read shared teams" on public.teams
  for select to anon, authenticated using (is_public);

drop policy if exists "Create own teams" on public.teams;
create policy "Create own teams" on public.teams
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Update own teams" on public.teams;
create policy "Update own teams" on public.teams
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Delete own teams" on public.teams;
create policy "Delete own teams" on public.teams
  for delete to authenticated using (user_id = auth.uid());

grant select on public.teams to anon;
grant select, insert, update, delete on public.teams to authenticated;
