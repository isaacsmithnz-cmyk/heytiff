-- Two scopes on a job (Isaac, 11 November 2026, on the builder's package
-- mock https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c: "supplied scope
-- and quoted scope ... a toggle switcher ... side by side for comparisons").
--
-- supplied: what the plans, the specification and the builder's or client's
-- emails asked for, written from them alone and never from our own notes, so
-- it can always be checked back on. supplied_stamp says which reads and
-- emails it was written from: a new one rewrites it. supplied_written_at is
-- when. brief_supplied_stamp says which supplied scope the quoted brief (the
-- brief column, unchanged) last started from, so a new supplied scope moves
-- the quoted one too.

alter table public.job_scopes add column if not exists supplied jsonb;
alter table public.job_scopes add column if not exists supplied_stamp text;
alter table public.job_scopes add column if not exists supplied_written_at timestamptz;
alter table public.job_scopes add column if not exists brief_supplied_stamp text;
