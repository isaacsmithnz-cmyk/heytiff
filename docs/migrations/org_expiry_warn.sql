-- One expiry-warning setting for everything (issue #640, piece 2 of 4).
--
-- WHAT ISAAC ASKED FOR. "Do we even need the Remind me button on the
-- insurance cards, or do we have a universal reminder setting for all things
-- that expire?" There was no setting. The window was hard-coded to 30 days in
-- six constants across three files — staff tickets, visas, the business's own
-- papers, rego, vehicle insurance, green slip, service — and the only way a
-- person could change when they heard about an expiry was to press Remind me
-- on each card, one at a time. Decision: ONE NUMBER FOR EVERYTHING, the
-- per-card buttons go, and Tiff's "remind me Monday" tasks are a separate
-- feature that stays exactly as it is.
--
-- AN EXPIRY WARNING IS NOT A REMINDER. A reminder is something a person asked
-- for, with a time on it, and lives as a task. An expiry is a fact the
-- software can see coming. So this is not a task row per expiry — it is a
-- window, read once per request and handed to the same pure rules the cards,
-- the dashboard and the bell already share. Nothing is created when a term is
-- filed, and nothing has to be kept in step when an expiry moves.
--
-- NOT NULL WITH A DEFAULT, unlike payment terms beside it. Terms are a claim
-- about an agreement with a customer and null is the honest "we don't know";
-- a warning window has no such ambiguity — every workspace has always warned
-- at 30, and a workspace that has not chosen keeps doing exactly that. The
-- CHECK keeps a typo'd 3000 from meaning "warn about everything, always".
--
-- THE EMAIL SWITCH RIDES BESIDE IT. Whether the morning email carries what is
-- inside the window. Same row, same read, same card on the Organisation page.
-- Default on: the morning list is the whole reason a person who was not in
-- the app to see the bell finds out at all.
--
-- The service km clock (1,500 km) is deliberately not here. It is a different
-- kind of limit and stays a constant in the fleet.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.organizations
  add column if not exists expiry_warn_days smallint not null default 30
    check (expiry_warn_days >= 1 and expiry_warn_days <= 365),
  add column if not exists expiry_email boolean not null default true;

comment on column public.organizations.expiry_warn_days is
  'Days before anything expires — a staff ticket, a visa, the business''s own licences and insurance, rego, vehicle insurance, green slip, a service by date — that the card, the dashboard, the bell and the morning email start saying so. One number for everything; the service km limit is a separate constant.';
comment on column public.organizations.expiry_email is
  'Whether the morning email carries what is inside the expiry window. The bell and the cards show it regardless.';
