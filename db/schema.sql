-- PitchDesk schema. Safe to run more than once.

create table if not exists settings (
  id int primary key default 1,
  guest_name text not null default '',
  sender_name text not null default '',
  offer text not null default '',
  proof text not null default '',
  ask text not null default '',
  topics text not null default '',
  voice text not null default '',
  signature text not null default '',
  subject_lines jsonb not null default '[]',
  discovery_terms jsonb not null default '[]',
  daily_cap int not null default 25,
  per_run_cap int not null default 3,
  send_start_hour int not null default 9,
  send_end_hour int not null default 16,
  timezone text not null default 'America/Toronto',
  followup1_days int not null default 4,
  followup2_days int not null default 7,
  auto_approve_followups boolean not null default true,
  min_fit_score int not null default 70,
  sending_paused boolean not null default false,
  slack_webhook_url text not null default '',
  last_tick_at timestamptz,
  last_tick_log text not null default '',
  updated_at timestamptz not null default now(),
  constraint settings_single_row check (id = 1)
);

create table if not exists gmail_account (
  id int primary key default 1,
  email text not null,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  constraint gmail_single_row check (id = 1)
);

create table if not exists shows (
  id serial primary key,
  podcast_index_id bigint unique,
  title text not null,
  author text,
  feed_url text unique,
  image_url text,
  link text,
  description text,
  categories text,
  host_email text,
  email_status text not null default 'unknown',
  last_episode_at timestamptz,
  episode_count int,
  latest_episodes jsonb not null default '[]',
  fit_score int,
  fit_reason text,
  status text not null default 'new',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shows_status_idx on shows(status);

create table if not exists pitches (
  id serial primary key,
  show_id int not null references shows(id) on delete cascade,
  step int not null default 0,
  subject text not null default '',
  body text not null,
  episode_ref text,
  status text not null default 'draft',
  send_after timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  rfc_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists pitches_status_idx on pitches(status, send_after);
create index if not exists pitches_show_idx on pitches(show_id);

create table if not exists replies (
  id serial primary key,
  show_id int not null references shows(id) on delete cascade,
  gmail_message_id text unique,
  thread_id text,
  from_email text,
  rfc_message_id text,
  subject text,
  body text,
  received_at timestamptz,
  classification text,
  suggested_reply text,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists activity (
  id serial primary key,
  show_id int references shows(id) on delete cascade,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on activity(created_at desc);

create table if not exists suppressions (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- Smart search results (also created automatically on first use).
create table if not exists searches (
  id serial primary key,
  brief text not null,
  terms jsonb not null default '[]',
  results jsonb not null default '[]',
  stats jsonb not null default '{}',
  created_at timestamptz not null default now()
);
