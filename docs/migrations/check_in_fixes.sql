-- A CHECK-IN LEFT ON, FIXED (Isaac, 28 October 2026: three ServiceM8
-- check-ins on the 27th ran to the next morning, so their hours counted for
-- nothing). Someone who manages the schedule says when the person really
-- finished; from then on HeyTiff reads that ServiceM8 check-in as ending
-- there: on the job card's time, its visits, and the phone's actual time.
-- ServiceM8's own record is not changed.
--
-- KEYED BY THE SERVICEM8 ACTIVITY'S UUID, NOT A FOREIGN KEY, for the reason
-- job_check_ins.sql gives: the mirror is a disposable cache, and a fix must
-- outlive it. `ends_at` is ServiceM8's own wall clock, "YYYY-MM-DD HH:MM:SS",
-- the way its stamps come.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.check_in_fixes (
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_activity_uuid text not null,
  ends_at text not null,
  fixed_by text not null,
  fixed_at timestamptz not null default now(),
  primary key (org_id, sm8_activity_uuid)
);

comment on table public.check_in_fixes is
  'When a ServiceM8 check-in left on really ended, said in HeyTiff by someone who manages the schedule. Read over the mirror wherever recorded time is counted; ServiceM8 itself is unchanged.';

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.check_in_fixes enable row level security;
