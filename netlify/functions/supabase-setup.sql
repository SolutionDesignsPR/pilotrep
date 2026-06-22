-- Run this in Supabase: Dashboard → SQL Editor → New Query → paste → Run

create table if not exists pilots (
  character_id   bigint       primary key,
  character_name text         not null,
  corporation_id bigint,
  alliance_id    bigint,
  created_at     timestamptz  not null default now(),
  last_login     timestamptz
);

-- Disable row-level security for now (enable and add policies before public launch)
alter table pilots disable row level security;
