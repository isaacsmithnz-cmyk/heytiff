-- Searching the read-photo bank.
--
-- WHY A FUNCTION AND NOT A QUERY IN THE ACTION. PostgREST's `or` filter takes
-- a COMMA-SEPARATED LIST, so a typed comma breaks out of it into two filters
-- and a typed `%` matches the entire bank. Getting that quoting right would
-- have meant writing a third party's escaping rules from memory into a string
-- nothing could test. Here the matching, the escaping and the ranking sit in
-- one place that can be exercised directly — and was, before it shipped:
--
--     '%'         -> 0 rows      'a,b'  -> 0 rows      '_'  -> 0 rows
--     'PUZ-M125'  -> the dataplate, matched on the transcription alone
--
-- FOUR MATCHERS, AND AN EARLIER VERSION OF THIS COMMENT WAS WRONG.
--
-- It claimed a tsvector cannot find a partial model number. Measured, that is
-- only true of `websearch_to_tsquery`, which has no way to emit `:*`:
--
--     to_tsvector('simple','MODEL PUZ-M125VKA2-A')
--       @@ websearch_to_tsquery('simple','PUZ-M125')              ->  FALSE
--       @@ to_tsquery('simple', quote_literal('puz-m125')||':*')  ->  TRUE
--
-- `puz-m125` is a PREFIX of the lexeme `puz-m125vka2-a`, and a prefix tsquery
-- is answered BY THE GIN INDEX. So the vector does the work, and ILIKE is left
-- with the one thing only it can do: a fragment starting in the MIDDLE of a
-- token (`vka2`), which no tsquery reaches. Tags stay separate because
-- array_to_string is only STABLE and a generated column refuses it.
--
-- quote_literal IS THE ESCAPING: it makes every typed word an opaque lexeme,
-- so `&`, `|`, `!` and `(` are text rather than tsquery syntax. An empty word
-- list makes string_agg NULL, to_tsquery NULL, and `@@ NULL` is NULL — never
-- true and never an error, so the empty case needs no branch.
--
-- THREE ILIKE BRANCHES WERE REMOVED, and both reasons matter:
--   * photo_name / job_number / client_name are unindexable that way, and ONE
--     unindexed branch in a disjunction forbids a BitmapOr for the whole
--     predicate — every search would then read every row for the org and
--     detoast ocr_text to filter it.
--   * `photo_name ilike '%photo%'` matched THE ENTIRE BANK, because ServiceM8
--     names every attachment `Photo`. All three are whole tokens in the
--     vector already, and the prefix leg covers partial typing of them
--     (`bunn` finds Bunnings, `907` finds the job).
--
-- The len >= 3 guard on the ILIKE legs keeps a two-character query on the
-- indexed path only.
--
-- THE TRANSCRIPTION IS WEIGHTED HIGHEST. If the string somebody typed is
-- literally printed on the equipment in the frame, that is not a coincidence
-- and not a near-miss. A tag is the weakest alone — tags are broad by design
-- — but it lifts a photo that also matched some other way, which is the
-- ensemble behaviour that makes a search feel like it works.
--
-- The four m_* flags come back so the screen can say WHY a photo matched
-- rather than leaving it a mystery.
--
-- SECURITY INVOKER (the default) and the org is a PARAMETER, never inferred:
-- the service role is the only caller and every action re-checks the session's
-- org for itself, exactly as every other read here does.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new function nothing calls yet.

create index if not exists job_photo_readings_caption_trgm_idx
  on public.job_photo_readings using gin (caption gin_trgm_ops);

create or replace function public.search_job_photos(
  p_org uuid,
  p_term text,
  p_limit int default 120
)
returns table (
  sm8_attachment_uuid text, sm8_job_uuid text, job_number text, client_name text,
  photo_name text, photo_taken_at text, subject text, tags text[], caption text,
  ocr_text text, read_at timestamptz,
  m_text boolean, m_transcript boolean, m_caption boolean, m_tag boolean, rank real
)
language sql
stable
as $$
  with q as (
    select
      btrim(p_term) as raw,
      char_length(btrim(p_term)) as len,
      -- the backslash is escaped FIRST or it eats the escaping that follows
      '%' || replace(replace(replace(btrim(p_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
      array_remove(
        string_to_array(lower(regexp_replace(btrim(p_term), '[^a-zA-Z0-9-]+', ' ', 'g')), ' '),
        ''
      ) as words
  ),
  t as (
    select q.*,
      to_tsquery(
        'simple'::regconfig,
        (select string_agg(quote_literal(w) || ':*', ' & ') from unnest(q.words) as w)
      ) as pre
    from q
  )
  select
    r.sm8_attachment_uuid, r.sm8_job_uuid, r.job_number, r.client_name,
    r.photo_name, r.photo_taken_at, r.subject, r.tags, r.caption, r.ocr_text, r.read_at,
    (r.search @@ t.pre)                                  as m_text,
    (t.len >= 3 and r.ocr_text ilike t.pat)              as m_transcript,
    (t.len >= 3 and r.caption  ilike t.pat)              as m_caption,
    (r.tags && t.words)                                  as m_tag,
    (
        case when t.len >= 3 and r.ocr_text ilike t.pat then 1.0 else 0 end
      + case when r.search @@ t.pre                     then 0.6 else 0 end
      + case when t.len >= 3 and r.caption ilike t.pat  then 0.5 else 0 end
      + case when r.tags && t.words                     then 0.25 else 0 end
    )::real                                              as rank
  from public.job_photo_readings r, t
  where r.org_id = p_org
    -- one character matches most of the bank and tells nobody anything
    and t.len >= 2
    and (
         r.search @@ t.pre
      or (t.len >= 3 and r.ocr_text ilike t.pat)
      or (t.len >= 3 and r.caption  ilike t.pat)
      or r.tags && t.words
    )
  order by rank desc, r.read_at desc
  limit least(greatest(p_limit, 1), 500)
$$;

comment on function public.search_job_photos(uuid, text, int) is
  'Search the read-photo bank. FOUR matchers: a PREFIX tsquery (finds PUZ-M125 inside the lexeme puz-m125vka2-a, through the GIN index), ILIKE for true mid-token fragments only, and tag overlap. photo_name/job_number/client_name ILIKE were REMOVED: an unindexed branch forbids a BitmapOr for the whole predicate, and ServiceM8 names every photo Photo so %photo% matched the entire bank.';
