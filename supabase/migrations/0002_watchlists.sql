-- Watchlists: strictly user-owned, protected by RLS. Anonymous demo
-- watchlists live in the browser (localStorage) — nothing here.

create table if not exists public.watchlist_items (
  satellite_number text        not null,
  user_id          uuid        not null references auth.users (id) on delete cascade,
  name             text        not null,
  added_at         timestamptz not null default now(),
  constraint watchlist_unique unique (user_id, satellite_number)
);

create index if not exists watchlist_user_idx
  on public.watchlist_items (user_id, added_at desc);

alter table public.watchlist_items enable row level security;

create policy "Users read their own watchlist"
  on public.watchlist_items
  for select
  using (auth.uid() = user_id);

create policy "Users insert their own watchlist rows"
  on public.watchlist_items
  for insert
  with check (auth.uid() = user_id);

create policy "Users delete their own watchlist rows"
  on public.watchlist_items
  for delete
  using (auth.uid() = user_id);

create policy "Users update their own watchlist rows"
  on public.watchlist_items
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
