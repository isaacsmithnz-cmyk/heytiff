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
-- sizing vocabulary: shirts are labelled XS–5XL on one rack and by CHEST in
-- centimetres on the next, trousers run the 72–117 waist ladder, women's
-- ranges number differently again. The card offers both ladders as datalist
-- SUGGESTIONS (lib/staff/uniform.ts) and takes whatever is typed, because the
-- next supplier will use a scale nobody here thought to list — and a CHECK
-- that rejects a real size is worse than a column holding "Ladies 14".
--
-- WHY BOOTS GET A SECOND COLUMN. A boot size is not a number, it is a number
-- in a SYSTEM: 10 in AU/UK is 44 in EU and 11 in US, so a bare "10" is an
-- order waiting to arrive two sizes out. `boot_scale` records which one was
-- meant and is picked, not typed — the app writes only 'AU/UK', 'EU' or 'US'
-- (the enum guard in section-patch.ts drops anything else), and NULL where no
-- boot size is held, because a scale with no number is not a fact. AU and UK
-- are one value on purpose: AU safety boots are UK-sized, and splitting them
-- would offer a distinction with no difference.
--
-- Still no CHECK on the scale, for the same reason as the sizes: the guard is
-- in the write path, where a bad value can be dropped with the rest of the
-- save intact, rather than in a constraint that turns it into a 500.
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
-- APPLIED 2026-08-24 (Supabase migration `staff_uniform_sizes`).
-- Re-runnable; all five columns are nullable.

alter table public.staff_profiles
  add column if not exists shirt_size    text,
  add column if not exists jacket_size   text,
  add column if not exists trousers_size text,
  add column if not exists boot_size     text,
  -- 'AU/UK' | 'EU' | 'US', and null wherever boot_size is null
  add column if not exists boot_scale    text;
