-- A new job for an EXISTING customer could never be queued (bug 76, Isaac,
-- 23 November 2026: "wont create", a job read from an email for a customer
-- already in ServiceM8).
--
-- The shape check's job line said
--   (job_company_new = 'site') = (job_parent_uuid is not null)
-- and for an existing customer job_company_new is null, so the left side is
-- null, the whole line null, and the check's coalesce(..., false) turned it
-- into a refusal. Only a new client or a new site ever got in. It is now
-- "is not distinct from", which is false for null: no new site, no builder.
--
-- The check has been rewritten by several migrations since; this one takes
-- the live check as it stands and changes that one clause, so nothing else
-- in it moves. It refuses to run if the clause isn't there exactly once.
do $$
declare
  was text;
  now_ text;
  old_clause constant text := '((job_company_new = ''site''::text) = (job_parent_uuid IS NOT NULL))';
  new_clause constant text := '((job_company_new IS NOT DISTINCT FROM ''site''::text) = (job_parent_uuid IS NOT NULL))';
begin
  select pg_get_constraintdef(oid) into was
    from pg_constraint where conname = 'sm8_writes_shape_check' and conrelid = 'public.sm8_writes'::regclass;
  if was is null then raise exception 'sm8_writes_shape_check is missing'; end if;
  if (length(was) - length(replace(was, old_clause, ''))) / length(old_clause) <> 1 then
    raise exception 'the job clause is not in the check exactly once';
  end if;
  now_ := replace(was, old_clause, new_clause);
  execute 'alter table public.sm8_writes drop constraint sm8_writes_shape_check';
  execute 'alter table public.sm8_writes add constraint sm8_writes_shape_check ' || now_;
end $$;
