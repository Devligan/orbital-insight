-- Orbital snapshots: deduplicated element-set history.
-- Uniqueness on (satellite_number, epoch) means repeated page views never
-- inflate history; identical provider records collapse to one row.
-- Retention: a bounded per-satellite cap is enforced by an application
-- pruning call (see README "Retention policy"), not by a cron job.

create table if not exists public.orbital_snapshots (
  id                bigint generated always as identity primary key,
  satellite_number  text        not null,
  name              text        not null,
  tle_line1         text        not null,
  tle_line2         text        not null,
  epoch             timestamptz not null,
  retrieved_at      timestamptz not null default now(),
  source            text        not null default 'celestrak',
  created_at        timestamptz not null default now(),
  constraint satellite_epoch_unique unique (satellite_number, epoch),
  constraint source_known check (source in ('celestrak'))
);

create index if not exists orbital_snapshots_satellite_idx
  on public.orbital_snapshots (satellite_number, epoch desc);

-- App-owned data: no authenticated-client writes. Row Level Security keeps
-- the table closed to anon/authed roles; only the service role (which
-- bypasses RLS) writes snapshot history.
alter table public.orbital_snapshots enable row level security;
