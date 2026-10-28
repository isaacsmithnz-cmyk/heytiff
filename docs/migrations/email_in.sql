-- ── EMAIL TO TIFF (Isaac, 28 October 2026: "I want to be able to forward an
-- email for a builder into tiff to create a job, read scope etc"; the mock
-- https://claude.ai/artifact/Qx4QPPPrw7ey96VdJUqs2p, "Build it in") ──
--
-- A business's address (src/lib/email/inbound.ts): one long random token a
-- business, tiff-<token>@in.hey-tiff.com. Making a new one replaces the row,
-- so the old address finds no one.
create table if not exists public.email_in_addresses (
  org_id   uuid primary key references public.organizations(id) on delete cascade,
  token    text not null unique,
  made_by  text,
  made_at  timestamptz not null default now()
);
alter table public.email_in_addresses enable row level security;

-- Each email that came in: who sent it (a team member's own address, vouched
-- for by their mail server, or it is refused and its words not kept), what it
-- said, its files (stored in the documents bucket under email-in/), what Tiff
-- read in it, and what came of it. One row a Resend email id, so a webhook
-- delivered twice is one email.
create table if not exists public.email_in_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  provider_id   text not null unique,
  received_at   timestamptz not null default now(),
  from_address  text not null,
  from_name     text,
  -- the team member it came from: their auth user id
  sender_sub    text,
  subject       text,
  body          text,
  -- [{ name, contentType, size, path }]
  files         jsonb not null default '[]'::jsonb,
  -- received | read | made | not_a_job | refused | failed
  state         text not null default 'received',
  why           text,
  -- Tiff's read: the job she proposes (src/lib/email/proposal.ts)
  proposal      jsonb,
  thread_id     text,
  job_uuid      text,
  decided_by    text,
  decided_at    timestamptz
);
create index if not exists email_in_messages_org_received on public.email_in_messages (org_id, received_at desc);
alter table public.email_in_messages enable row level security;
