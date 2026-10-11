-- ── the book searched loosely (2026-10-11) ──
-- Isaac: "Just do fuzzy book now". When no item holds every word of a
-- search, the items with most of them, a word typed a letter out
-- ("difuser", "isolater") counted by its nearest word in the item, half its
-- three-letter runs shared (pg_trgm's strict_word_similarity, the same
-- count src/lib/quotes/fuzzy.ts makes in the app). Words only: a code a
-- digit out is another part. The nearest first, then the most bought.
-- pg_trgm is already installed (public, 1.6).
create or replace function public.quote_items_like(p_org uuid, p_words text[], p_limit integer default 12)
returns table (supplier_key text, code text, score real)
language sql
stable
set search_path = public
as $$
  with w as (
    select distinct lower(x) as word
    from unnest(p_words) x
    where length(x) >= 3 and lower(x) not in ('and', 'the', 'for', 'with')
  ),
  scored as (
    select i.supplier_key, i.code, i.times_bought,
      case
        when position(w.word in lower(i.code || ' ' || i.name)) > 0 then 1
        when w.word ~ '^[a-z]{4,}$' then strict_word_similarity(w.word, lower(i.code || ' ' || i.name))
        else 0
      end as s
    from public.quote_price_items i
    cross join w
    where i.org_id = p_org and i.current
  )
  select supplier_key, code, sum(s)::real as score
  from scored
  where s >= 0.5
  group by supplier_key, code
  having count(*) >= ceil((select count(*) from w)::numeric / 2)
  order by sum(s) desc, max(times_bought) desc nulls last, code
  limit least(greatest(coalesce(p_limit, 12), 1), 50)
$$;

-- the app calls it with the service role; nobody else may
revoke execute on function public.quote_items_like(uuid, text[], integer) from public, anon, authenticated;
grant execute on function public.quote_items_like(uuid, text[], integer) to service_role;
