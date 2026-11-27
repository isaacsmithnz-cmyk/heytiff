-- ONE LIST OF UNITS, SHARED BY THE DESIGN AND THE QUOTE (Isaac, 27 November
-- 2026: "Yes, build it" to https://claude.ai/artifact/1Dhn6R3di6pdBX9F3ah3Nk).
--
-- A quote's unit line joined to the units of the job's Studio design it is:
-- the design's id, the units' allocation ids (the id a unit keeps through a
-- swap), and what the two said when they last agreed, so a change on
-- either side is known for whose it was (src/lib/quotes/design-units.ts):
--
--   { "design": "dsn_…", "units": ["obj_…"], "model": "PEFY-P40VMX-E", "code": "PEFY-P40VMX-E1" }
--   { "design": "dsn_…", "units": [], "only": true }            the quote's only
--   { "design": "dsn_…", "units": [], "take": "…", "system": "sys_…", "room": "…" }
--                                                               the design to take it, for the Studio
--
-- Null: not joined yet. Written apart from the line's own fields: a join
-- isn't a change to the quote, so it neither bumps the line's version nor
-- its updated_at (an approval stands until a line changes).
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one nullable column. Additive and idempotent.

alter table public.quote_lines add column if not exists design_unit jsonb;
