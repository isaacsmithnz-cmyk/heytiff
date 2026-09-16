-- ASKING ONE DOCUMENT, AND MEANING IT.
--
-- The library row's "Ask Tiff about this document" opened the composer with
-- `In “City Multi fault codes”, ` typed into it and then searched the WHOLE
-- library, so the answer could be quoted out of a different manual than the
-- one the reader picked. The button's own comment said "this button's whole
-- promise is that the answer comes out of THIS document"; nothing kept it,
-- because neither search function could be told which document to read.
--
-- Both gain `p_doc`, defaulted to null, which is the shape that lets this land
-- BEFORE the code that uses it: every existing four-argument call still
-- resolves, and searches the whole library exactly as it did. Drop-and-create
-- rather than `create or replace`, because adding a parameter changes the
-- identity — leaving the old one in place would make a four-argument call
-- ambiguous between the two and fail at the database.
--
-- The grants are restated for the same reason: they go with the dropped
-- function. They are the ones the two carried (execute to anon, authenticated
-- and service_role, as `create function` gives by default in this project).

begin;

drop function if exists public.kb_fts(uuid, text, text[], int);

create function public.kb_fts(
  p_org uuid,
  p_query text,
  p_cats text[],
  p_k int,
  p_doc uuid default null
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
    -- one document, when the asker named one; the whole library otherwise
    and (p_doc is null or c.document_id = p_doc)
    and c.tsv @@ q.tsq
  -- the EXPRESSION, not the output column's name: a `returns table` column is
  -- also an OUT parameter, and an unqualified `rank` in here is ambiguous
  -- between the two, which Postgres refuses at creation time
  order by ts_rank_cd(c.tsv, q.tsq) desc
  limit greatest(coalesce(p_k, 12), 1);
$$;

drop function if exists public.kb_vec(uuid, extensions.vector, text[], int);

create function public.kb_vec(
  p_org uuid,
  p_qvec extensions.vector(1024),
  p_cats text[],
  p_k int,
  p_doc uuid default null
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
    and (p_doc is null or c.document_id = p_doc)
  order by c.embedding <=> p_qvec
  limit greatest(coalesce(p_k, 12), 1);
$$;

grant execute on function public.kb_fts(uuid, text, text[], int, uuid) to anon, authenticated, service_role;
grant execute on function public.kb_vec(uuid, extensions.vector, text[], int, uuid) to anon, authenticated, service_role;

commit;
