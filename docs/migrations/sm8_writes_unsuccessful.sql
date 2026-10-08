-- A QUOTE MARKED UNSUCCESSFUL (Isaac, 2026-10-08: "Owner only for the Mark
-- Unsuccessful button"). Analytics' lost quote, made Unsuccessful in
-- ServiceM8 by an owner's press (src/app/actions/booking-sm8.ts
-- markUnsuccessful): one booking status row, alone, from Quote to
-- Unsuccessful, sent and read back exactly as Make it a Work Order is
-- (src/lib/integrations/sm8-booking-send.ts).
--
-- Widens one clause of sm8_writes_shape_check, a booking update's
--   job_status_to = 'Work Order'
-- to
--   job_status_to in ('Work Order', 'Unsuccessful')
-- and nothing else. The check is rewritten from its own definition as the
-- database holds it, so every other clause stays exactly as it is; and it
-- refuses to run unless that clause appears once and only once.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: every row the code before it wrote
-- still passes, and it never writes Unsuccessful.

do $$
declare
  def text;
  was constant text := '(job_status_to = ''Work Order''::text)';
  now_ constant text := '(job_status_to = ANY (ARRAY[''Work Order''::text, ''Unsuccessful''::text]))';
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conrelid = 'public.sm8_writes'::regclass and conname = 'sm8_writes_shape_check';
  if def is null then
    raise exception 'sm8_writes_shape_check is not there';
  end if;
  if position(now_ in def) > 0 then
    return; -- already applied
  end if;
  if (length(def) - length(replace(def, was, ''))) / length(was) <> 1 then
    raise exception 'sm8_writes_shape_check does not read as expected: its Work Order clause is not there exactly once';
  end if;
  execute 'alter table public.sm8_writes drop constraint sm8_writes_shape_check';
  execute 'alter table public.sm8_writes add constraint sm8_writes_shape_check ' || replace(def, was, now_);
end $$;
