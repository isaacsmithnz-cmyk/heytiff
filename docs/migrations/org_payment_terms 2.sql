-- When a raised claim becomes overdue — the last unwired half of slice 1.
--
-- `deriveFamilyMoney` has taken a `termsDays` since #553 and has computed
-- `dueOn` and `overdueDays` off it since #554; the money block has rendered
-- both since the day it shipped. Every one of those call sites passed NULL,
-- because the number did not exist anywhere in the app. So a job with $15,670
-- raised in April said only when it was RAISED, and the overdue chip the
-- design asked for could never appear.
--
-- WHY IT CANNOT COME FROM SERVICEM8. ServiceM8 does not mirror an invoice's
-- payment terms — there is no field for it on the job, the invoice or the
-- company, and nothing in the read charter would bring one across if there
-- were. The terms are the BUSINESS's policy, not the mirror's fact, so they
-- have to be a HeyTiff setting or they have to stay absent. An invented
-- fortnight would be the screen making up a date and then calling somebody
-- late against it.
--
-- NULLABLE, AND NULL IS THE HONEST DEFAULT. Unset, the claim rows keep saying
-- exactly what they say today: raised on such a date, nothing about due. No
-- backfill, no "most people use 14" — a due date is a claim about an
-- agreement with a customer, and we either know it or we don't.
--
-- 0 IS A REAL ANSWER, not an empty one: due on receipt. The derivation reads
-- `termsDays !== null`, so zero puts the due date on the raise date, which is
-- what "payment on invoice" means. The upper bound only keeps a typo'd 3000
-- out of a date constructor.
--
-- ONE NUMBER FOR THE ORG, NOT PER CUSTOMER. Per-customer terms are a real
-- thing and a bigger feature (a column on the client, an override on the job,
-- and a story about which wins). This is the number the business runs on; the
-- day a customer needs their own, it overrides this rather than replacing it.

alter table public.organizations
  add column if not exists payment_terms_days smallint
    check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 180));

comment on column public.organizations.payment_terms_days is
  'Days after an invoice is raised before it is overdue — the business''s own policy, since ServiceM8 never mirrors invoice terms. NULL means unset, and the money block then says when a claim was raised and nothing about when it is due. 0 means due on receipt.';
