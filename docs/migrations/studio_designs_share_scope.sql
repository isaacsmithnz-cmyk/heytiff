-- What the customer's live link shows — the Send dialog's ticks, kept beside
-- the token they belong to (lib/studio/send.ts `LinkScope`).
--
-- `{ "parts": ["figures", "systems", "plans", "sim"], "hiddenFloorIds": [] }`
--
-- NULL IS A LINK MADE BEFORE THIS EXISTED, and it keeps showing what it
-- always did: the sheet with its pipe and electrical, and the simulation
-- where it is ticked ready (LEGACY_LINK_SCOPE). So the column is additive and
-- nullable, and it was applied to prod BEFORE the code that reads it
-- deployed: the live route selects it, and a select of a missing column would
-- 404 every link a customer holds.
--
-- Floors are stored as the ones LEFT OUT, so a floor drawn after the link was
-- made appears on it. Revoking the link nulls this with the token.

alter table public.studio_designs
  add column if not exists share_scope jsonb;
