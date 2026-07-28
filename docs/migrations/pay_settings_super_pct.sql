-- Superannuation % moves home to pay_settings. APPLIED 2026-07-28.
--
-- The audit's C2: the org's super rate lived in rate_calc_state.state->
-- settings->super_pct — a PRICING blob — and every staff member's My Pay card
-- read it from there. Editing a pricing assumption changed what people saw as
-- their super. pay_settings is the org's pay configuration home, so the rate
-- lives here now: Time & Pay settings owns the edit, My Pay and the Rate
-- Calculator both read it. NULL means "never set" — consumers fall back to
-- the statutory default rather than storing a guess.

alter table public.pay_settings
  add column if not exists super_pct numeric(4,2)
    check (super_pct is null or (super_pct >= 0 and super_pct <= 25));

-- Seed from wherever an org had already set it in the calculator, so the
-- move changes an owner's screen, never a person's number.
update public.pay_settings ps
   set super_pct = sub.pct
  from (
    select org_id, nullif(state->'settings'->>'super_pct', '')::numeric as pct
      from public.rate_calc_state
  ) sub
 where sub.org_id = ps.org_id
   and ps.super_pct is null
   and sub.pct is not null;
