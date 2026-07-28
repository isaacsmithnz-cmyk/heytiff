-- Pay basis: how someone's pay is COMPUTED, orthogonal to employment type.
-- APPLIED 2026-07-28.
--
-- A salaried person is paid the same every week; their timesheet is a record,
-- not an input. This is deliberately NOT a sixth employment type — full-time/
-- part-time describes the engagement and a part-timer can be salaried, so a
-- basis column keeps classifyEmployment untouched. 'hourly' default keeps
-- every existing person exactly as they were.
--
-- pay_settings.salaried_ot_paid is the org's one decision about salaried
-- overtime: TRUE = an extended day pays at the weekend/OT rules (on the
-- salary-derived hourly, annual ÷ 52 ÷ weekly hours — the drift work's own
-- arithmetic); FALSE = "reasonable additional hours" are absorbed — the block
-- is still RECORDED on the sheet, it just doesn't move the money. Recording a
-- fact is always safe; implying pay that won't come isn't.

alter table public.staff_profiles
  add column if not exists pay_basis text not null default 'hourly'
    check (pay_basis in ('hourly', 'salary'));

alter table public.pay_settings
  add column if not exists salaried_ot_paid boolean not null default true;
