-- Renewal reminders, and the morning email that delivers reminders (vehicle
-- modal v2, phase 3).
--
-- A REMINDER IS STILL A TASK. task_reminders.sql made the rule: a reminder is
-- a task with a time on it, derived at read, no delivery state. "Remind me 30
-- days before the rego expires" is the same thing with a vehicle attached —
-- a task titled "Renew rego — WORK TRITON (YLI59V)", due 30 days before the
-- expiry, nudged that morning. It rings the bell, sits on Home's day rail,
-- snoozes and completes like every other task, and nothing new had to be
-- built to make it do any of that.
--
-- THREE COLUMNS SAY WHAT IT IS ABOUT. `vehicle_id`, `renewal_kind` and
-- `lead_days` are how the card knows which chips are on (derived: is there an
-- open task of mine for this vehicle, this kind, this lead?) and how a
-- recorded renewal finds the reminders to move: the expiry changes, so the
-- due dates change with it, for everyone who asked. Cascade on the vehicle —
-- a reminder about a vehicle that no longer exists is not a task anyone can
-- do.
--
-- THE MAILER GETS ITS STAMP. task_reminders.sql said email delivery would
-- need its own bookkeeping because an email cannot be un-sent, and reserved
-- the column for that migration. This is it. `reminder_emailed_at` is set by
-- the daily digest (api/cron/reminders) when a reminder was included in a
-- letter that left; null means it has not been. It is the ONLY delivery state
-- in the reminders feature, and it exists because the alternative is sending
-- the same email every morning.
--
-- POSTURE: RLS on with no policies, unchanged; enforcement stays app-layer.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.tasks
  add column if not exists vehicle_id          uuid references public.vehicles (id) on delete cascade,
  add column if not exists renewal_kind        text
    check (renewal_kind is null or renewal_kind in ('rego', 'insurance', 'ctp')),
  add column if not exists lead_days           integer check (lead_days is null or lead_days >= 0),
  add column if not exists reminder_emailed_at timestamptz;

comment on column public.tasks.vehicle_id is
  'Set on a renewal reminder: the vehicle whose expiry it counts down to. Null on every other task.';
comment on column public.tasks.lead_days is
  'Set on a renewal reminder: how many days before the expiry it falls due (30, 14, 7, 0). Null on every other task.';
comment on column public.tasks.reminder_emailed_at is
  'When this reminder went out in a morning digest. Null = not yet. The mailer''s only bookkeeping.';

-- The card's read and the renewal's re-dating: one vehicle's open reminders.
create index if not exists tasks_renewal_idx
  on public.tasks (org_id, vehicle_id, renewal_kind)
  where vehicle_id is not null and status = 'open';

-- The mailer's read: open reminders whose time has come and that have not
-- been emailed. Partial, because almost every task is neither.
create index if not exists tasks_remind_mail_idx
  on public.tasks (remind_at)
  where remind_at is not null and status = 'open' and reminder_emailed_at is null;
