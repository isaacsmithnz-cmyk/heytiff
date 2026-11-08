-- A BLOCK OUT GOES TO SERVICEM8 AS PART OF A DAY (Isaac, 9 November 2026:
-- "Can you fix it", after a 2:15 to 2:45 block on him never reached
-- ServiceM8). Block out time (#1431) sends a placed block as staff leave
-- for its own part of the day, but a leave create was only allowed as
-- whole days, 00:00:00 to 23:59:59, so the database refused it.
--
-- Widens two clauses of sm8_writes_shape_check, a leave create's
--   leave_start ~ '... 00:00:00$'   and   leave_end ~ '... 23:59:59$'
-- to any time of day, to the second, and nothing else: start before end
-- still holds. The check is rewritten from its own definition as the
-- database holds it, so every other clause stays exactly as it is; and it
-- refuses to run unless each clause appears once and only once.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: every row the code before it wrote
-- still passes.

do $$
declare
  def text;
  start_was constant text := '(leave_start ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2} 00:00:00$''::text)';
  end_was constant text := '(leave_end ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2} 23:59:59$''::text)';
  start_now constant text := '(leave_start ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$''::text)';
  end_now constant text := '(leave_end ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$''::text)';
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conrelid = 'public.sm8_writes'::regclass and conname = 'sm8_writes_shape_check';
  if def is null then
    raise exception 'sm8_writes_shape_check is not there';
  end if;
  if position(start_now in def) > 0 and position(end_now in def) > 0 then
    return; -- already applied
  end if;
  if (length(def) - length(replace(def, start_was, ''))) / length(start_was) <> 1
     or (length(def) - length(replace(def, end_was, ''))) / length(end_was) <> 1 then
    raise exception 'sm8_writes_shape_check does not read as expected: a leave create''s whole-day clauses are not there exactly once each';
  end if;
  execute 'alter table public.sm8_writes drop constraint sm8_writes_shape_check';
  execute 'alter table public.sm8_writes add constraint sm8_writes_shape_check '
    || replace(replace(def, start_was, start_now), end_was, end_now);
end $$;
