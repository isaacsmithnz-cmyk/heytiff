-- org_brand_color — the one colour a business picks, for its own documents.
--
-- ONE COLUMN, ONE SEED. Not a palette: the roles a document paints with are
-- DERIVED from this at render (lib/org/theme.ts::documentTheme), pushed until
-- each one measures against the ground it sits on. Storing the derived roles
-- instead would freeze them — a value computed against #ffffff in August is
-- wrong the day a surface changes ground, and nothing would notice.
--
-- WHY THE CHECK IS WORTH HAVING even though actions/org.ts validates first.
-- A Server Function is reachable by direct POST, so app-layer validation is
-- the message, not the guarantee; and this column is read straight into a
-- style attribute on a customer's document. A CSS colour slot that accepts
-- arbitrary text is a place to put things that are not colours. The pattern is
-- deliberately narrow — six lowercase hex digits with a hash, exactly what
-- documentTheme() normalises to — so a shorthand or an uppercase value is a
-- write bug caught here rather than a rendering surprise later.
--
-- NULL is the real and common state: it means "no theme", and every document
-- falls back to precisely the look it has today. Nothing about this migration
-- changes an existing org.
--
-- POSTURE: no new RLS surface. organizations is already deny-all to the public
-- keys and reached only through the service role, same as every other column
-- on this table.
--
-- SAFE TO APPLY AHEAD OF THE PR: a nullable column nothing reads yet.

alter table public.organizations
  add column if not exists brand_color text;

alter table public.organizations
  drop constraint if exists organizations_brand_color_check;

alter table public.organizations
  add constraint organizations_brand_color_check
  check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$');

comment on column public.organizations.brand_color is
  'Seed colour for this business''s customer-facing documents. Lowercase #rrggbb '
  'or null. Never painted raw — lib/org/theme.ts derives the legible roles from it.';
