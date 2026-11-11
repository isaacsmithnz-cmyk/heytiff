-- What you've swiped off your phone's notifications (Isaac, 2026-11-11:
-- "Notifications, I want to have a swiping feature on those where you can
-- swipe to the left or the right with actions", then "Yes, build it" to
-- https://claude.ai/artifact/766ntHx3oPedW4oieP6f9b).
--
-- A notification is derived (lib/mobile/notifications: a task given you, a
-- reminder due, a ServiceM8 ask, a notice, declined leave), so nothing held
-- "this one's off my list". Clear writes its id here and the list leaves it
-- out; the task, notice or ask itself is untouched. Undo deletes the row.
--
-- WHEN TO APPLY: before the deploy. Additive and idempotent; new code reads
-- nothing from it where it is missing (the list is simply uncleared).
--
-- READ-ONLY, AFTER:
--   select to_regclass('public.notification_clears');                     -- notification_clears
--   select relrowsecurity from pg_class where relname = 'notification_clears';   -- true
--   select count(*) from pg_policies where tablename = 'notification_clears';    -- 0

create table if not exists public.notification_clears (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  -- the phone's own id for it: `${kind}:${id}`, e.g. "notice:…" or "mention:<job>:<asker>"
  notification_id  text not null check (length(notification_id) between 3 and 200),
  cleared_at       timestamptz not null default now(),
  primary key (staff_profile_id, notification_id)
);

create index if not exists notification_clears_org on public.notification_clears (org_id);

comment on table public.notification_clears is
  'Notifications a person swiped Clear (or Done, where Done changes nothing else) on the phone; the list leaves them out.';

-- the server reads and writes it with the service key; nobody else
alter table public.notification_clears enable row level security;
