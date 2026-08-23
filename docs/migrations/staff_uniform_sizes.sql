-- Uniform sizes on the staff card — what to order when someone starts, and
-- what to re-order when a shirt wears through.
--
-- WHY COLUMNS AND NOT A TABLE. A size is one value per person per garment,
-- with no history worth keeping: nobody asks what shirt size someone took in
-- 2023, they ask what to order today. Four nullable text columns beside the
-- rest of the personal facts is the whole shape, and it rides the personal
-- section's existing save — no new table, no new allowlist, no new capability.
--
-- WHY TEXT AND NOT A CHECK CONSTRAINT. Australian workwear has no single
-- sizing vocabulary: shirts run XS–5XL, trousers run the 72–117 waist ladder
-- OR S/M/L depending on the brand, women's ranges number differently again,
-- and boots come in half sizes and in US/UK conversions. The card offers the
-- common ladders as datalist SUGGESTIONS (lib/staff/uniform.ts) and takes
-- whatever is typed, because the next supplier will use a scale nobody here
-- thought to list — and a CHECK that rejects a real size is worse than a
-- column holding "Ladies 14".
--
-- SELF-SERVICE ON PURPOSE. These join the `personal` allowlist in BOTH
-- lib/staff/profile.ts (your own card) and lib/staff/admin-sections.ts
-- (someone else's, behind `team`). Your own sizes are the one thing on this
-- screen you know better than the office does, and getting them wrong orders
-- a shirt, not a pay run — unlike `status` or `job_title`, which stay
-- business-set.
--
-- Nothing derives from these: they don't count toward profile completeness
-- (see completeness.ts) and no query filters on them, so they are additive
-- and live code is indifferent until the PR lands.
--
-- POSTURE: RLS unchanged — staff_profiles stays deny-all, all access through
-- the service-role client behind the app's own gates.
--
-- APPLY THIS BEFORE MERGING THE PR. Re-runnable; all four are nullable.

alter table public.staff_profiles
  add column if not exists shirt_size    text,
  add column if not exists jacket_size   text,
  add column if not exists trousers_size text,
  add column if not exists boot_size     text;
