-- org_logo_tone — what a business's logo looks like, so a document can draw it.
--
-- A logo's INK is a property of the file: a white wordmark is the right logo for
-- a dark website header and is simply absent on a white document, which is how a
-- quote's masthead came out with a blank top-right corner. The browser measures
-- it once, at upload (lib/org/logo-fit.ts), and each surface decides from this
-- and its own ground whether the logo needs a plate behind it
-- (lib/org/brand.ts::plateFor).
--
--   light  the ink is pale: needs a dark plate on a document
--   dark   the ink is dark: needs a light plate on a dark bar
--   mixed  both, or a mid-tone: bare on a document, light plate on a dark bar
--
-- NULL is the real and common state: every logo uploaded before this existed.
-- Surfaces treat it exactly as they always did, so nothing about this migration
-- changes an existing org. Re-uploading the logo measures it.
--
-- THE CHECK IS WORTH HAVING even though actions/org.ts validates first: a Server
-- Function is reachable by direct POST, so the app-layer check is the message,
-- not the guarantee, and this column is read straight into a class name.
--
-- POSTURE: no new RLS surface. organizations is already deny-all to the public
-- keys and reached only through the service role.
--
-- APPLY BEFORE THE CODE DEPLOYS. orgBrand() now selects this column, and it
-- fails SOFT — a missing column reads as "no brand", which would blank every
-- letterhead on every document until the column exists.

alter table public.organizations
  add column if not exists logo_tone text
  check (logo_tone is null or logo_tone in ('light', 'dark', 'mixed'));
