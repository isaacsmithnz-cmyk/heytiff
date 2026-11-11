-- A finished Work Order made Completed in ServiceM8 (Isaac, 11 November 2026:
-- "complete the job or like mark it ready to invoice ... so that the office
-- knows the clear end result"; How did it end?'s Ready to invoice, the
-- office's Checked). A booking-kind status row may now also go from Work
-- Order to Completed (actions/sm8-booking-queue queueMarkCompleted), beside
-- Quote to Work Order or Unsuccessful. NOT APPLIED: it waits for Isaac's yes.
-- Until it is, a Completed row is refused at the insert and Checked stays
-- HeyTiff's alone. Nothing calls queueMarkCompleted yet: wiring Checked to it
-- comes after this is applied.
--
-- The shape check is rebuilt with the one clause changed:
--   (job_status_from = 'Quote' AND job_status_to = ANY (ARRAY['Work Order','Unsuccessful']))
-- becomes
--   ((job_status_from = 'Quote' AND job_status_to = ANY (ARRAY['Work Order','Unsuccessful']))
--    OR (job_status_from = 'Work Order' AND job_status_to = 'Completed'))
-- Run as one transaction: read the current definition, replace that clause, add it back.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.sm8_writes'::regclass and conname = 'sm8_writes_shape_check';
  if def is null then raise exception 'sm8_writes_shape_check not found'; end if;
  if position('''Completed''' in def) > 0 then return; end if;
  def := replace(def,
    '(job_status_from = ''Quote''::text) AND (job_status_to = ANY (ARRAY[''Work Order''::text, ''Unsuccessful''::text]))',
    '(((job_status_from = ''Quote''::text) AND (job_status_to = ANY (ARRAY[''Work Order''::text, ''Unsuccessful''::text]))) OR ((job_status_from = ''Work Order''::text) AND (job_status_to = ''Completed''::text)))');
  if position('''Completed''' in def) = 0 then raise exception 'the status clause was not found to replace'; end if;
  execute 'alter table public.sm8_writes drop constraint sm8_writes_shape_check';
  execute 'alter table public.sm8_writes add constraint sm8_writes_shape_check ' || def;
end $$;
