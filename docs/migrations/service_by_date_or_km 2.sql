-- A service falls due on distance OR time, whichever arrives first.
--
-- WHAT ISAAC ASKED FOR, in his words: "vehicle intervals are by date/kms
-- whichever is first. kms are updated at fuel fill to keep track. anything
-- without a motor can just have service date."
--
-- WHY THE DISTANCE-ONLY MODEL WAS WRONG. A manufacturer's schedule reads
-- "every 10,000 km or 12 months, whichever comes first" — the time limit is
-- what catches the van that barely moves, which is exactly the van whose oil
-- is quietly ageing. Modelling only the distance half meant a low-km vehicle
-- could never come due, and a trailer — no motor, no odometer, no distance to
-- measure — could never come due at all.
--
-- TWO LIMITS, NOT A UNIT. The temptation is one interval plus a "measured in"
-- unit. That is the wrong shape: it forces a choice where real servicing wants
-- both, and it would make "10,000 km or 12 months" inexpressible. So each
-- limit is its own nullable pair — an interval and the anchor it counts from —
-- and either being null simply means that limit does not apply.
--
--   distance: last_service_odo + service_interval_km   vs  odometer
--   time:     last_service_on  + service_interval_months vs today
--
-- WHICHEVER IS FIRST needs no prediction. There is no km-per-day rate to
-- invent and no ranking of a distance against a date: the service is due when
-- the FIRST limit is reached, so whichever trips, trips. The screen shows both
-- and the warning takes the worse of the two.
--
-- `motorised` is the honest discriminator, and it is the fact the rules
-- actually need — not a type enum they would have to map through. A trailer
-- has no motor, therefore no odometer, therefore no distance limit. Deriving
-- that from a category would put the answer one lookup away from the question
-- and get it wrong the first time a category nobody listed turned up.

alter table public.vehicles
  add column if not exists service_interval_months int
    check (service_interval_months is null or service_interval_months > 0),
  add column if not exists last_service_on date,
  add column if not exists motorised boolean not null default true;

comment on column public.vehicles.service_interval_months is
  'The time half of the service cycle. Null = this vehicle has no time limit.';
comment on column public.vehicles.last_service_on is
  'The date the time limit counts from. Null = no service has anchored it yet.';
comment on column public.vehicles.motorised is
  'False for anything with no motor (a trailer): no odometer, so no distance limit.';

-- Null now MEANS something — "no distance limit" — so it must be sayable.
-- The default goes with it: a vehicle should carry the interval its handbook
-- states, not the one this column happened to be born with. Existing rows keep
-- the value they already have; nothing is cleared.
alter table public.vehicles alter column service_interval_km drop not null;
alter table public.vehicles alter column service_interval_km drop default;

-- Anchor the time limit from the services already on record. This is READ, not
-- invented: it is the date of that vehicle's most recent service log. Vehicles
-- with no service logged stay null and simply have no time limit until one is
-- set — a made-up anchor would start a countdown nobody began.
update public.vehicles v
set last_service_on = s.on_date
from (
  select vehicle_id, max(logged_on) as on_date
  from public.vehicle_logs
  where kind = 'service'
  group by vehicle_id
) s
where s.vehicle_id = v.id
  and v.last_service_on is null;

-- Deliberately NOT done here: giving every vehicle a 12-month interval, and
-- marking the trailer motorless. Both are claims about Isaac's fleet rather
-- than facts already in the table, and both are two clicks in the vehicle form.
