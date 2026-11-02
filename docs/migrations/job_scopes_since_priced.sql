-- ── WHAT'S LANDED ON A JOB SINCE ITS QUOTE WAS PRICED (slice 3 of the scope) ──
--
-- since_priced: what a note added to the brief while the quote already had
-- lines, for the quote's rail; off it once it's priced or left out. It stays
-- in the brief either way.
-- quote_stamp: the quote's conversation as the brief last read it, so what's
-- said on the quote reaches the brief, once.

alter table public.job_scopes
  add column if not exists since_priced jsonb not null default '[]'::jsonb,
  add column if not exists quote_stamp text;
