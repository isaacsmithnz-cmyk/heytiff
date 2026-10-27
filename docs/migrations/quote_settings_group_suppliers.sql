-- BUY ALL FROM, A GROUP'S SUPPLIER (Isaac, 28 October 2026: "select Voltex and
-- all ductwork will be quoted at Voltex").
--
-- The common install items come in eight groups (src/lib/quotes/install-groups.ts).
-- A business can buy a whole group from one supplier: its parts are priced from
-- that supplier's items where it sells them, and from the lowest elsewhere where
-- it doesn't. A part chosen on its own still wins. Group key -> supplier key.
--
-- APPLIED 28 October 2026, before the PR: one new column with an empty default,
-- nothing read it until the PR merged.

alter table quote_settings add column if not exists group_suppliers jsonb not null default '{}'::jsonb;
