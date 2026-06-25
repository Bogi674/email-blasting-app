-- ============================================================================
--  Email Blast Console  —  Supabase schema
--  Run this in the Supabase SQL editor (Dashboard > SQL > New query > Run).
--  Safe to re-run: it drops and recreates the objects it owns.
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
--  Tables
-- ============================================================================

-- Sending accounts (SMTP, SendGrid, etc.) ------------------------------------
create table if not exists public.sending_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  from_email  text not null,
  from_name   text,
  type        text not null check (type in ('smtp', 'sendgrid')),
  is_default  boolean not null default false,
  -- config holds provider credentials, e.g.
  --   smtp:     { "host","port","secure","username","password" }
  --   sendgrid: { "apiKey" }
  -- See README for the recommended Supabase Vault hardening for production.
  config      jsonb not null default '{}'::jsonb,
  status      text not null default 'connected',
  created_at  timestamptz not null default now()
);

-- Reusable email templates ---------------------------------------------------
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  subject     text not null default '',
  body_html   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Campaigns (a single blast) -------------------------------------------------
create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  account_id   uuid references public.sending_accounts (id) on delete set null,
  template_id  uuid references public.templates (id) on delete set null,
  subject      text not null default '',
  body_html    text not null default '',
  status       text not null default 'draft'
                 check (status in ('draft','queued','sending','done','failed')),
  total        integer not null default 0,
  sent         integer not null default 0,
  failed       integer not null default 0,
  scheduled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Recipients (one row per address, per campaign) -----------------------------
create table if not exists public.recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  -- merge_data maps merge keys to values, e.g. { "nama_lengkap": "Budi" }
  merge_data  jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
                 check (status in ('pending','sent','failed','skipped')),
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Unsubscribes (suppression list, per user) ----------------------------------
create table if not exists public.unsubscribes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  unique (user_id, email)
);

-- Helpful indexes ------------------------------------------------------------
create index if not exists idx_recipients_campaign on public.recipients (campaign_id);
create index if not exists idx_recipients_status   on public.recipients (campaign_id, status);
create index if not exists idx_campaigns_user      on public.campaigns (user_id, created_at desc);
create index if not exists idx_accounts_user       on public.sending_accounts (user_id);
create index if not exists idx_templates_user      on public.templates (user_id, updated_at desc);

-- ============================================================================
--  Row Level Security  — every row is scoped to its owner (auth.uid()).
--  The Netlify function uses the service-role key, which bypasses RLS.
-- ============================================================================

alter table public.sending_accounts enable row level security;
alter table public.templates        enable row level security;
alter table public.campaigns         enable row level security;
alter table public.recipients        enable row level security;
alter table public.unsubscribes      enable row level security;

-- sending_accounts
drop policy if exists "own accounts" on public.sending_accounts;
create policy "own accounts" on public.sending_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- templates
drop policy if exists "own templates" on public.templates;
create policy "own templates" on public.templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- campaigns
drop policy if exists "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- recipients
drop policy if exists "own recipients" on public.recipients;
create policy "own recipients" on public.recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- unsubscribes
drop policy if exists "own unsubscribes" on public.unsubscribes;
create policy "own unsubscribes" on public.unsubscribes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
--  updated_at trigger
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_campaigns_touch on public.campaigns;
create trigger trg_campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_templates_touch on public.templates;
create trigger trg_templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();
