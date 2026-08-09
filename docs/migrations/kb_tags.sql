-- Tags on library documents — the second axis.
--
-- WHY A SECOND AXIS AT ALL. `category` answers "what kind of document is this"
-- and there are exactly five answers, fixed in product structure. It cannot
-- answer "whose gear is this about" or "which system type", and those are the
-- two things a tech actually narrows by: a Daikin VRV service manual and a
-- Fujitsu ducted service manual are the same category and nothing alike.
-- Category is a shelf; tags are what's written on the spine.
--
-- WHY A TABLE AND NOT `tags text[]`. An array column can hold the words but it
-- cannot hold a colour, cannot be renamed in one place, and turns every typo
-- into a permanent second tag. The whole ask here — "new tags can be created
-- and a colour selected" — is a row with an identity, so it is a row.
--
-- SLUG IS THE DEDUPE KEY, LABEL IS THE PRINT. "daikin", "Daikin" and " DAIKIN "
-- are one tag; which capitalisation is shown is an edit, not a new tag. The
-- unique index is on (org_id, slug) for that reason and not on the label.
--
-- SEEDS ARE NOT IN HERE. A starter set of manufacturers and system types lives
-- in lib/tiff/tags.ts and is materialised the first time an org's library asks
-- for its tags — so a workspace created next month gets them too, without this
-- migration having to know about it or org creation having to import a list.
--
-- POSTURE: RLS ON, NO policies — deny-all house-wide, same as kb_documents and
-- kb_chunks. The service role reads and writes behind can("tiff") /
-- can("tiff_manage"), and every query carries .eq("org_id"). Both foreign keys
-- on the join table are COMPOSITE and carry org_id, so a document can never
-- wear another workspace's tag even if an id leaks.
--
-- THE SEARCH FUNCTIONS ARE DELIBERATELY UNTOUCHED. kb_fts and kb_vec keep
-- their signatures: scoping an ANSWER by tag is a later, additive change, and
-- adding a parameter to either would mean dropping and recreating a function
-- that retrieval depends on.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.kb_tags (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,

  -- What's shown. Trade acronyms are cased on the way in (lib/tiff/tags.ts),
  -- so somebody typing "vrv" stores "VRV" and every chip reads the way a tech
  -- would write it.
  label      text not null check (length(btrim(label)) between 1 and 40),

  -- Lowercased, punctuation collapsed to single hyphens. The identity.
  slug       text not null check (length(slug) between 1 and 40),

  -- Decoration only, and never a semantic state colour — #00A389 and #e0264f
  -- mean "ok" and "danger" everywhere else in the app, and a tag that happened
  -- to be teal would read as a status. The app picks from a fixed palette; the
  -- CHECK here only insists it is a colour at all.
  color      text not null default '#6b7280' check (color ~ '^#[0-9a-f]{6}$'),

  -- Grouping for the picker, so twenty manufacturers don't sit in one soup
  -- with twenty system types. Not a permission, not a filter axis.
  kind       text not null default 'topic' check (kind in ('brand', 'system', 'topic')),

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, slug),
  -- the join below points at this pair, so the index has to exist here
  unique (id, org_id)
);

create index if not exists kb_tags_org_kind_idx on public.kb_tags (org_id, kind, label);

-- Which document wears which tag. No id of its own: the pair IS the fact, and
-- a surrogate key would allow the same tag twice on one document.
create table if not exists public.kb_document_tags (
  org_id      uuid not null,
  document_id uuid not null,
  tag_id      uuid not null,
  created_at  timestamptz not null default now(),

  primary key (document_id, tag_id),

  constraint kb_document_tags_document_fkey
    foreign key (document_id, org_id)
    references public.kb_documents(id, org_id) on delete cascade,

  constraint kb_document_tags_tag_fkey
    foreign key (tag_id, org_id)
    references public.kb_tags(id, org_id) on delete cascade
);

-- The primary key already serves document → tags. This is the other direction:
-- "how many documents wear this tag", which the manage sheet asks for every
-- tag at once before it will let one be deleted.
create index if not exists kb_document_tags_org_tag_idx
  on public.kb_document_tags (org_id, tag_id);

alter table public.kb_tags enable row level security;
alter table public.kb_document_tags enable row level security;

comment on table public.kb_tags is
  'Library tags — manufacturer, system type or topic. Org-scoped; slug is the dedupe key.';
comment on table public.kb_document_tags is
  'Which kb_documents wear which kb_tags. Composite FKs carry org_id so a tag cannot cross a workspace.';
