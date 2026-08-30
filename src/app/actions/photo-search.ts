"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import {
  PHOTO_SEARCH_LIMIT,
  parsePhotoQuery,
  rankPhotos,
  type PhotoMatch,
} from "@/lib/workboard/photo-search";

/* Searching the bank — every photo on every job anyone has opened.

   THIS IS NOT THE SHOWCASE. The showcase is the starred set, curated by hand;
   the bank is everything that has been read. Search spans the bank, because
   the whole point is finding a photograph you did NOT think to star at the
   time. Stars are what you would show someone; the bank is what you can find.

   FOUR MATCHERS, measured — and an earlier version of this comment claimed
   three, on a premise that was too strong. A tsvector CAN find a partial
   model number; only `websearch_to_tsquery` cannot, because it has no way to
   emit a prefix:

     to_tsvector('simple','MODEL PUZ-M125VKA2-A')
       @@ websearch_to_tsquery('simple','PUZ-M125')              ->  FALSE
       @@ to_tsquery('simple', quote_literal('puz-m125')||':*')  ->  TRUE

   So the prefix tsquery carries the weight, through the GIN index, and ILIKE
   is left with true mid-token fragments (`vka2`) that no tsquery reaches.
   Tags are their own matcher because array_to_string is only STABLE and a
   generated column refuses it.

   `search_job_photos` does the matching, the escaping and the ranking — see
   the migration for why all three had to be in one place that could be
   tested. TypeScript re-ranks on the same weights so the two can never
   silently disagree. */

export type PhotoHit = {
  remoteId: string;
  jobUuid: string;
  jobNumber: string | null;
  clientName: string | null;
  name: string;
  takenAt: string | null;
  subject: string | null;
  tags: string[];
  caption: string;
  /** The transcription, for showing WHY a photo matched. */
  ocrText: string;
  url: string | null;
  readAt: string;
  /** Which of the three matchers fired — the rank is derived from this, and
      the UI can say what it matched on rather than leaving it a mystery. */
  match: PhotoMatch;
};

export type PhotoSearchResult = {
  ok: boolean;
  hits: PhotoHit[];
  /** How many photos have been read at all. A search that finds nothing means
      something very different against a bank of 12 than against one of 4,000,
      and the screen has to be able to say which. */
  banked: number;
  /** True when the cap bound — say so rather than implying that was all. */
  capped: boolean;
};

const NOTHING: PhotoSearchResult = { ok: false, hits: [], banked: 0, capped: false };

/** One row as `search_job_photos` returns it — the four `m_*` flags say WHICH
    matcher fired, so the screen can tell somebody why a photo came back. */
type HitRow = {
  sm8_attachment_uuid: string;
  sm8_job_uuid: string;
  job_number: string | null;
  client_name: string | null;
  photo_name: string;
  photo_taken_at: string | null;
  subject: string | null;
  tags: string[] | null;
  caption: string | null;
  ocr_text: string | null;
  read_at: string;
  m_text: boolean | null;
  m_transcript: boolean | null;
  m_caption: boolean | null;
  m_tag: boolean | null;
};

/** How many photos this workspace has read. Cheap, and the number that makes
    an empty result honest. */
export async function countBankedPhotos(): Promise<number> {
  const { orgId } = await requireOrg("workboard");
  const { count } = await supabaseAdmin
    .from("job_photo_readings")
    .select("sm8_attachment_uuid", { count: "exact", head: true })
    .eq("org_id", orgId);
  return count ?? 0;
}

export async function searchPhotos(term: string): Promise<PhotoSearchResult> {
  try {
    return await searchPhotosInner(term);
  } catch (e) {
    console.error("[photo-search] failed:", e);
    return NOTHING;
  }
}

async function searchPhotosInner(term: string): Promise<PhotoSearchResult> {
  const { orgId } = await requireOrg("workboard");
  const query = parsePhotoQuery(term);

  const { count: bankedCount } = await supabaseAdmin
    .from("job_photo_readings")
    .select("sm8_attachment_uuid", { count: "exact", head: true })
    .eq("org_id", orgId);
  const banked = bankedCount ?? 0;

  if (!query.usable) return { ok: true, hits: [], banked, capped: false };

  /* THE QUERY IS A POSTGRES FUNCTION, NOT A FILTER STRING. PostgREST's `or`
     takes a comma-separated list, so a typed comma breaks out of it into two
     filters and a typed `%` matches the whole bank — and getting the quoting
     right would have been syntax written from memory against a service whose
     escaping rules I would not have tested. `search_job_photos` does the
     matching, the escaping and the ranking in one place that CAN be tested
     directly, and it was: `%`, `_` and `a,b` all return nothing, while
     `PUZ-M125` finds the dataplate the tsvector alone cannot. */
  const { data, error } = await supabaseAdmin.rpc("search_job_photos", {
    p_org: orgId,
    p_term: query.raw,
    p_limit: PHOTO_SEARCH_LIMIT + 1,
  });

  if (error) {
    console.error("[photo-search] query refused:", error);
    return { ...NOTHING, banked };
  }

  const rows = (data ?? []) as HitRow[];
  const capped = rows.length > PHOTO_SEARCH_LIMIT;
  const kept = capped ? rows.slice(0, PHOTO_SEARCH_LIMIT) : rows;

  /* The function already ranked these. `rankPhotos` re-sorts on the same
     weights so the two can never silently disagree — and so the ordering is
     covered by a test that needs no database. */
  const scored = kept.map((r) => ({
    remoteId: r.sm8_attachment_uuid,
    jobUuid: r.sm8_job_uuid,
    jobNumber: r.job_number,
    clientName: r.client_name,
    name: r.photo_name,
    takenAt: r.photo_taken_at,
    subject: r.subject,
    tags: r.tags ?? [],
    caption: r.caption ?? "",
    ocrText: r.ocr_text ?? "",
    url: null as string | null,
    readAt: r.read_at,
    match: {
      text: !!r.m_text,
      transcript: !!r.m_transcript,
      caption: !!r.m_caption,
      tag: !!r.m_tag,
    },
  }));

  const ranked = rankPhotos(scored);
  await attachUrls(orgId, ranked);
  return { ok: true, hits: ranked, banked, capped };
}

/** Sign every hit's picture in ONE call, not one per photo — the same rule the
    job card's media read follows, and the reason the bytes are in this bucket.
    A hit whose cached copy has since been cleared keeps a null url and draws
    as a plate; it is still a real result. */
async function attachUrls(orgId: string, hits: PhotoHit[]): Promise<void> {
  if (hits.length === 0) return;
  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select("remote_ref, storage_ref")
    .eq("org_id", orgId)
    .eq("source", "servicem8")
    .in(
      "remote_ref",
      hits.map((h) => h.remoteId)
    )
    .not("uploaded_at", "is", null);

  const refOf = new Map(
    ((docs ?? []) as { remote_ref: string | null; storage_ref: string }[])
      .filter((d) => d.remote_ref)
      .map((d) => [d.remote_ref as string, d.storage_ref])
  );
  if (refOf.size === 0) return;

  const { data: signed } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls([...new Set(refOf.values())], SIGNED_URL_SECONDS);
  const urlOf = new Map<string, string>();
  for (const row of signed ?? []) {
    if (row.path && row.signedUrl) urlOf.set(row.path, row.signedUrl);
  }
  for (const h of hits) {
    const ref = refOf.get(h.remoteId);
    h.url = ref ? urlOf.get(ref) ?? null : null;
  }
}
