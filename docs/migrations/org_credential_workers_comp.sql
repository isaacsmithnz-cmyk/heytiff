-- Two facts a workers compensation certificate prints that had nowhere to go.
--
-- WHAT ISAAC ASKED FOR: "add the workers comp fields, as long as it's
-- something that's commonly used or required." So the test each candidate had
-- to pass was not "is it on the page" but "does anyone USE it", and the
-- certificate answers that itself. icare's certificate of currency carries an
-- "Important information" block headed "Principals relying on this certificate
-- should:", and two of its five bullets are:
--
--     · compare the number of workers on site to the average number of
--       workers estimated
--     · ensure that the wages are reasonable to cover the labour component of
--       the work being performed
--
-- That is the head contractor's instruction, printed by the scheme insurer, to
-- read exactly these two numbers. A subcontractor who cannot produce them
-- cannot answer the question they are about to be asked. Isaac's own
-- certificate (policy 127993501, 28/02/2026–28/02/2027) prints 11 workers and
-- $943,669.32 of wages, and until now the app filed the document and threw
-- both away.
--
-- WHAT WAS DELIBERATELY LEFT OUT. The claims service provider (Gallagher
-- Bassett on that certificate) is real and printed, but nobody checks it when
-- verifying cover — it matters at claim time, and by then you open the
-- certificate. Same for the issue date, which is not the period. A column that
-- is never read is a column that goes stale.
--
-- WHY COLUMNS AND NOT A JSONB BAG. sum_insured, premium and excess are already
-- explicit typed columns on this table with their own CHECK constraints; a
-- second, untyped way to store a number would mean two places to look and two
-- validators to keep honest. Which papers carry which facts is answered ONCE,
-- in termFieldsFor (src/lib/org/credentials.ts), and that already narrows the
-- form, the fact grid and Tiff's prompt together.
--
-- NULLABLE AND NEVER DERIVED, like every other figure here. A certificate that
-- does not print a worker count must not have one invented, for the same
-- reason fuel GST is never divided out of a total.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.org_credential_records
  -- the average number of workers the policy is rated on, as printed. Includes
  -- contractors and deemed workers, which is why it is not the org's headcount
  -- and must never be derived from staff_profiles.
  add column if not exists workers_count integer
    check (workers_count is null or workers_count >= 0),
  -- total wages/units declared for the period, GST-free, as printed
  add column if not exists wages numeric(14, 2)
    check (wages is null or wages >= 0);

comment on column public.org_credential_records.workers_count is
  'Workers compensation: the number of workers the premium is rated on, as printed on the certificate. Null on every other kind of paper.';
comment on column public.org_credential_records.wages is
  'Workers compensation: wages/units declared for the period, as printed. Null on every other kind of paper.';
