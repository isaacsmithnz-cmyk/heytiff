-- How full a day is — the denominator behind the Schedule's capacity month.
--
-- WHY THIS TABLE EXISTS AT ALL. The month view scores a day as booked hours
-- over available hours, and the available half cannot be derived from anything
-- already stored. Two things were tried on paper first and both are wrong:
--
--   · count the people who have bookings that day — which makes a quiet
--     Tuesday read FULL, because the two people out that day are the only two
--     the arithmetic knows about.
--   · count the ServiceM8 staff list — which is not a crew. This account's
--     holds `Pending Jobs` (a placeholder work is parked against) and
--     `HeyTiff` alongside eleven real people and eight deactivated ones, so
--     the denominator would include somebody fictional.
--
-- So availability is a LIST SOMEBODY CHOSE, and this is where the choice
-- lives. It is the whole feature: change who is in it and every cell in the
-- month rescores.
--
-- KEYED ON THE SERVICEM8 STAFF UUID, NOT A HEYTIFF STAFF CARD. The app's law
-- for one-truth-per-staff-member is `integration_links`, and by that law this
-- should hang off a staff profile. It does not, for a measured reason: at the
-- time of writing that table holds ZERO staff rows for this org — every
-- `staff_profile_id` against a `sm8_staff` row is null, because nobody has
-- been linked yet. Keying on the card would ship an allocation list with
-- nobody in it, on the one screen whose entire job is naming a crew.
--
-- The diary's lanes are keyed on `sm8_staff.uuid` for the same reason, so this
-- agrees with the surface it belongs to. WHEN THOSE LINKS EXIST this becomes a
-- join rather than a rewrite: the uuid stays the key, and the name is read
-- through the link instead of from the mirror.
--
-- NO FOREIGN KEY TO sm8_staff, deliberately. The mirror is rebuilt by a walk
-- and its rows are soft-deleted (`active = 0`) rather than removed, so a hard
-- reference would either block a resync or cascade a person's hours away when
-- ServiceM8 deactivates them. An allocation row for somebody who has left is
-- harmless — they contribute nothing once `included` is false, and their
-- typical hours are still there if they come back.
--
-- `included` IS A COLUMN, NOT A DELETE. Toggling somebody out of the index has
-- to keep what their day was set to, or every toggle is a re-entry job. That
-- is the difference between a checkbox and a delete, and it is the reason this
-- is not just a list of rows that exist.
--
-- MINUTES, NOT HOURS. Half-days and 7.5-hour days are ordinary, and a month
-- total is a sum: storing hours as a numeric invites a rounding error that
-- only shows up at the bottom of the column.
--
-- POSTURE: RLS ON, NO policies (deny-all house-wide); enforcement is
-- app-layer, and every read and write goes through the `workboard`
-- capability — writes additionally through `workboard_manage`.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.schedule_capacity_staff (
  org_id          uuid    not null references public.organizations(id) on delete cascade,
  -- ServiceM8's staff uuid. Text, matching sm8_staff.uuid — the mirror stores
  -- provider ids as text throughout and does not assume they are uuids.
  sm8_staff_uuid  text    not null,
  -- in the denominator, or set aside with their hours kept
  included        boolean not null default true,
  -- what this person typically does in a working day. 8h.
  daily_minutes   integer not null default 480
                    constraint schedule_capacity_staff_daily_minutes_sane
                    check (daily_minutes >= 0 and daily_minutes <= 1440),
  updated_at      timestamptz not null default now(),
  updated_by      text,
  primary key (org_id, sm8_staff_uuid)
);

alter table public.schedule_capacity_staff enable row level security;

comment on table public.schedule_capacity_staff is
  'Who counts toward a day''s capacity on the Schedule month, and for how long. '
  'Keyed on the ServiceM8 staff uuid because integration_links holds no staff '
  'rows yet; see the header of this migration before changing that.';
