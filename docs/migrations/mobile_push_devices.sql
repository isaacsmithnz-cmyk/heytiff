-- ── the phones HeyTiff can push to (2026-10-26) ──
-- Isaac, 26 October 2026: "build out the notifications in general so I can
-- see how native apps look". The phone app (heytiff-mobile) asks Expo for a
-- push token once it is allowed to notify, and sends it here
-- (POST /api/mobile/push/devices); lib/mobile/push sends to every phone a
-- person is signed in on when something lands on them (a task given, a
-- ServiceM8 note that asks them something).
--
-- One row per phone. `token` is Expo's ("ExponentPushToken[…]"), unique: a
-- phone signed in as someone else moves its row to them. `user_sub` is the
-- Auth0 subject the phone's token check verified, in the workspace it was
-- reading. A token Expo answers DeviceNotRegistered for is deleted by the
-- sender; signing out deletes the phone's own.
--
-- Private: the app reads and writes it with the service role; nobody else
-- may. Adds a table and nothing else.
create table if not exists public.mobile_push_devices (
  token         text primary key check (char_length(token) between 10 and 300),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_sub      text not null check (char_length(user_sub) between 1 and 200),
  platform      text not null check (platform in ('android', 'ios')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists mobile_push_devices_person
  on public.mobile_push_devices (org_id, user_sub);
alter table public.mobile_push_devices enable row level security;
