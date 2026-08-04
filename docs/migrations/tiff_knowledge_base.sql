-- Tiff AI knowledge base — the library, its chunks, and what a month costs.
--
-- THE SHAPE OF THE FEATURE: a manual is uploaded as a PDF, its text layer is
-- read page by page, cut into overlapping chunks, keyword-tagged and embedded.
-- Asking a question searches those chunks two ways at once — keywords through
-- Postgres FTS, meaning through pgvector — and answers with citations back to
-- the document and page. Nothing here answers anything; this is where the
-- searchable material lives.
--
-- WHY TWO SEARCH LEGS: a tech types "P8 error on a PUZ-ZM250" — a model number
-- and a fault code, which an embedding blurs and a keyword index nails. They
-- also type "outdoor unit keeps tripping in the heat", which keywords miss and
-- an embedding gets. Neither leg is optional, so both are indexed and the
-- merge happens in TS (lib/tiff/rank.ts, a later PR).
--
-- INGESTION IS RESUMABLE, NOT TRANSACTIONAL. `next_page` is a bookmark: each
-- ~20-page batch advances it, so a 400-page manual crosses many requests and a
-- failure costs the current batch rather than the document. `status` is the
-- honest state of that walk — uploading | processing | paused | ready | failed
-- — and `paused` specifically means "this org's monthly page allowance ran
-- out", which resumes at the bookmark when the month rolls or the plan changes.
--
-- USAGE OUTLIVES THE DOCUMENT. kb_usage counts pages processed and questions
-- asked per org per AU month, and is never touched when a document is deleted:
-- the pages were still processed and still cost money. Deleting a manual is
-- not a refund.
--
-- POSTURE: RLS ON, NO policies (deny-all house-wide); the service role reads
-- and writes behind can("tiff") / can("tiff_manage") gates, and every query
-- carries .eq("org_id"). Composite FKs carry org_id so a chunk can never point
-- at another workspace's document.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- pgvector, in the schema Supabase keeps extensions in. Every reference to the
-- type, the opclass and the distance operator below is schema-qualified or
-- runs under a search_path that includes it — an unqualified `vector` resolves
-- to nothing from a function that doesn't say where to look.
create extension if not exists vector with schema extensions;

-- ── what an org is entitled to ──────────────────────────────────────────────

-- The subscription tier the page allowance keys off. Every existing org lands
-- on 'standard' by default; plan changes are a SQL flip until billing exists.
alter table public.organizations
  add column if not exists plan text not null default 'standard'
    check (plan in ('trial', 'standard', 'pro', 'unlimited'));

-- Two counters and nothing else. `month` is the FIRST of the month on the AU
-- calendar (lib/tiff/quota.ts::auMonthStart) — a UTC month would reset an
-- Australian org's allowance up to 11 hours early on the wrong day.
create table if not exists public.kb_usage (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  month            date not null,
  pages_processed  int not null default 0,
  questions_asked  int not null default 0,
  primary key (org_id, month)
);

-- The only writer. Read-modify-write from the app would lose counts whenever
-- two ingest batches land together, and losing them always undercounts — which
-- is the direction that costs money. One statement, atomic, no read first.
--
-- SECURITY INVOKER (the default) on purpose, here and on the two search
-- functions below. Postgres grants EXECUTE to PUBLIC, so every function in
-- `public` is reachable with the anon key through PostgREST; as invoker they
-- run as that caller and hit the deny-all RLS on the tables they touch. A
-- `security definer` would have handed an anonymous caller a way to inflate
-- another org's counters — and to read their chunks.
create or replace function public.kb_usage_add(
  p_org uuid,
  p_month date,
  p_pages int,
  p_questions int
) returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  insert into public.kb_usage (org_id, month, pages_processed, questions_asked)
  values (
    p_org,
    -- normalised, so a caller passing a mid-month date can't open a second
    -- bucket for the same month
    date_trunc('month', p_month)::date,
    greatest(coalesce(p_pages, 0), 0),
    greatest(coalesce(p_questions, 0), 0)
  )
  on conflict (org_id, month) do update
    set pages_processed = kb_usage.pages_processed + excluded.pages_processed,
        questions_asked = kb_usage.questions_asked + excluded.questions_asked;
$$;

-- ── the library ─────────────────────────────────────────────────────────────

create table if not exists public.kb_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,

  -- The four categories are product structure: they colour the cards, filter
  -- the library and scope a search. Fixed on purpose.
  category      text not null check (category in ('install', 'faults', 'specs', 'sops')),

  title         text not null,
  -- The brand or body it came from ("Mitsubishi Electric", "AS/NZS 3000"), and
  -- which revision — both are how a tech decides whether to trust an answer.
  source        text,
  edition       text,

  -- v1 reads PDF text layers only. DOCX/XLSX/images are deferred, and the
  -- column exists so adding one is a CHECK edit rather than a shape change.
  kind          text not null default 'PDF' check (kind in ('PDF')),

  storage_ref   text,
  mime_type     text,
  size_bytes    bigint,

  -- Filled on the first successful open. `scanned_pages` counts pages whose
  -- text layer was empty — surfaced honestly ("12 pages unreadable — scanned
  -- images") rather than indexed as blank.
  page_count    int,
  scanned_pages int not null default 0,

  status        text not null default 'uploading'
                  check (status in ('uploading', 'processing', 'paused', 'ready', 'failed')),
  error         text,

  -- The resume bookmark: the next page to read, 1-based. Never rewound except
  -- by a deliberate re-ingest.
  next_page     int not null default 1,
  chunk_count   int not null default 0,

  uploaded_by   uuid,
  uploaded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- kb_chunks points at this pair, so the unique index has to exist here.
  unique (id, org_id),

  constraint kb_documents_uploaded_by_fkey
    foreign key (uploaded_by, org_id)
    references public.staff_profiles(id, org_id) on delete set null (uploaded_by)
);

create index if not exists kb_documents_org_status_idx
  on public.kb_documents (org_id, status);
create index if not exists kb_documents_org_category_idx
  on public.kb_documents (org_id, category);

-- ── what search actually reads ──────────────────────────────────────────────

-- array_to_string(anyarray, text) is only STABLE to the planner, and a
-- generated column must be IMMUTABLE — for text[] the result is in fact
-- deterministic, which this wrapper is allowed to promise on its behalf.
create or replace function public.kb_keywords_text(p text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(array_to_string(p, ' '), '') $$;

create table if not exists public.kb_chunks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  document_id  uuid not null,

  -- Position in the document, so chunks read back in order and a re-run can
  -- continue the numbering rather than restart it.
  chunk_index  int not null,

  content      text not null,
  -- A chunk can straddle a page break; both ends are kept so a citation can
  -- say "p.42–43" instead of guessing.
  page_from    int not null,
  page_to      int not null,
  heading      text,

  -- Model numbers, fault codes, components, symptoms — what a tech would
  -- actually type. Weighted 'A' below, above the heading and the prose.
  keywords     text[] not null default '{}',

  -- Null until Voyage is configured; the vector leg simply skips those rows,
  -- and a later re-run backfills them. Keyword search never stops working.
  embedding    extensions.vector(1024),

  tsv tsvector generated always as (
    setweight(to_tsvector('english', kb_keywords_text(keywords)), 'A') ||
    setweight(to_tsvector('english', coalesce(heading, '')), 'B') ||
    setweight(to_tsvector('english', content), 'C')
  ) stored,

  constraint kb_chunks_document_fkey
    foreign key (document_id, org_id)
    references public.kb_documents(id, org_id) on delete cascade
);

create index if not exists kb_chunks_tsv_idx on public.kb_chunks using gin (tsv);

-- Partial: most rows have no embedding until a key exists, and indexing nulls
-- costs build time for hits that can never happen.
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create index if not exists kb_chunks_org_doc_idx
  on public.kb_chunks (org_id, document_id, chunk_index);

-- ── the two search legs ─────────────────────────────────────────────────────

-- Keywords. `websearch_to_tsquery` is the parser that takes what a person
-- types (quotes, OR, a leading minus) without throwing on punctuation the way
-- to_tsquery does. ts_rank_cd weights by cover density, so a chunk that says
-- the terms near each other beats one that mentions them pages apart.
--
-- Only 'ready' documents are searchable: a half-ingested manual would answer
-- with the first twenty pages and look like the whole book.
create or replace function public.kb_fts(
  p_org uuid,
  p_query text,
  p_cats text[],
  p_k int
) returns table (
  id uuid,
  document_id uuid,
  rank real,
  page_from int,
  page_to int
)
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq)
  select c.id, c.document_id, ts_rank_cd(c.tsv, q.tsq), c.page_from, c.page_to
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id and d.org_id = c.org_id
  cross join q
  where c.org_id = p_org
    and d.status = 'ready'
    and (p_cats is null or cardinality(p_cats) = 0 or d.category = any (p_cats))
    and c.tsv @@ q.tsq
  -- the EXPRESSION, not the output column's name: a `returns table` column is
  -- also an OUT parameter, and an unqualified `rank` in here is ambiguous
  -- between the two, which Postgres refuses at creation time
  order by ts_rank_cd(c.tsv, q.tsq) desc
  limit greatest(coalesce(p_k, 12), 1);
$$;

-- Meaning. `<=>` is cosine DISTANCE (0 = identical), which is what the HNSW
-- index is built for — ordering by anything else silently falls back to a scan.
create or replace function public.kb_vec(
  p_org uuid,
  p_qvec extensions.vector(1024),
  p_cats text[],
  p_k int
) returns table (
  id uuid,
  document_id uuid,
  distance double precision,
  page_from int,
  page_to int
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select
    c.id,
    c.document_id,
    (c.embedding <=> p_qvec)::double precision,
    c.page_from,
    c.page_to
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id and d.org_id = c.org_id
  where c.org_id = p_org
    and c.embedding is not null
    and d.status = 'ready'
    and (p_cats is null or cardinality(p_cats) = 0 or d.category = any (p_cats))
  order by c.embedding <=> p_qvec
  limit greatest(coalesce(p_k, 12), 1);
$$;

-- ── posture ─────────────────────────────────────────────────────────────────

alter table public.kb_usage enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;

-- ── where the bytes live ────────────────────────────────────────────────────

-- Private, PDF-only, 50 MB — deliberately NOT the `documents` bucket, which is
-- capped at 10 MB and shaped around notice attachments. A manufacturer's
-- install manual is routinely 30 MB, so it gets its own door with its own
-- limits. The app checks the same two numbers before handing out a slot
-- (lib/tiff/files.ts); this is the floor under a client that skips that check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kb', 'kb', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;
