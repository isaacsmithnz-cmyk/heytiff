/* Field notes — publishing crew knowledge into the KB. Server only.

   The write half of the LEARN lane. The note brain proposes a "Worth
   teaching everyone" row; a human ticks it on the review card; THIS is what
   the tick does. One kb_documents row (kind NOTE, category 'field', ready
   from birth) and one kb_chunks row, embedded and keyword-indexed so both
   retrieval legs can find it — after this, a field note IS a document as far
   as asking Tiff is concerned. The provenance a manual carries in its title
   and pages, a field note carries in its heading: who learned it, when, and
   on what job.

   NO SESSION HERE: the caller (applyNote) established the right to write and
   hands in the org and author. Same posture as every module in lib/tiff.

   FAILURE KEEPS THE KNOWLEDGE. If the embedding service is down, the chunk
   is inserted with a null vector — the keyword leg still finds it, and the
   existing backfill story covers the rest. The only hard failure is the
   database refusing the rows, and the caller surfaces that instead of
   pretending the tick worked. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { embedTexts } from "./embeddings";

export type FieldNoteInput = {
  orgId: string;
  /** staff_profiles id of whoever said it — becomes uploaded_by. */
  authorId: string | null;
  /** Their display name, for the heading retrieval will quote. */
  authorName: string;
  title: string;
  body: string;
  /** "Meridian Data · Server room CRACs" — where it was learned, if a job
      was in scope. Provenance, not a foreign key: the knowledge outlives
      the job. */
  jobLabel?: string | null;
  /** AU-formatted day, e.g. "Wed 6 Aug" — the caller already knows the
      org's timezone and this module shouldn't re-derive it. */
  dayLabel: string;
  /** Threads back to the sentence it came from. */
  noteId?: string | null;
};

export type PublishResult = { ok: true; documentId: string } | { ok: false; error: string };

const TITLE_MAX = 200;
const BODY_MAX = 4000;

/** The provenance line, built one way so retrieval, the library card and the
    admin queue all say the same thing. */
export function fieldNoteHeading(input: Pick<FieldNoteInput, "authorName" | "dayLabel" | "jobLabel">): string {
  const at = input.jobLabel ? ` · at ${input.jobLabel}` : "";
  return `Learned on the job — ${input.authorName}, ${input.dayLabel}${at}`;
}

export async function publishFieldNote(input: FieldNoteInput): Promise<PublishResult> {
  const title = input.title.trim().slice(0, TITLE_MAX);
  const body = input.body.trim().slice(0, BODY_MAX);
  if (!title || !body) return { ok: false, error: "There's no knowledge in that entry." };

  const heading = fieldNoteHeading(input);

  /* The embedding happens BEFORE the rows exist, so a vector failure can
     degrade gracefully into a keyword-only chunk rather than a document
     with no chunk. The text embedded is heading + body: the heading names
     the job and author, which is exactly what a "what did Luke do at
     Meridian" question needs the vector to carry. */
  const embedded = await embedTexts([`${heading}\n${title}\n${body}`], "document");
  const vector = embedded.ok ? (embedded.vectors?.[0] ?? null) : null;

  const { data: doc, error: docErr } = await supabaseAdmin
    .from("kb_documents")
    .insert({
      org_id: input.orgId,
      category: "field",
      kind: "NOTE",
      title,
      /* `source` is "the brand or body it came from" on a manual. For a
         field note that is a person. */
      source: input.authorName,
      status: "ready",
      page_count: 1,
      chunk_count: 1,
      uploaded_by: input.authorId,
      uploaded_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (docErr || !doc) return { ok: false, error: "The library wouldn't take that entry." };
  const documentId = String(doc.id);

  const { error: chunkErr } = await supabaseAdmin.from("kb_chunks").insert({
    org_id: input.orgId,
    document_id: documentId,
    chunk_index: 0,
    content: body,
    page_from: 1,
    page_to: 1,
    heading,
    /* No model call for keywords on a one-chunk note — the title's own words
       are the keywords a tech would type, and a second Opus call on the save
       path would double its latency for marginal recall. */
    keywords: keywordsFromTitle(title),
    embedding: vector ? JSON.stringify(vector) : null,
  });
  if (chunkErr) {
    /* A document with no chunk is invisible to search and undeletable noise
       in the library — take the header row back out rather than leave it. */
    await supabaseAdmin.from("kb_documents").delete().eq("org_id", input.orgId).eq("id", documentId);
    return { ok: false, error: "The library wouldn't take that entry." };
  }

  return { ok: true, documentId };
}

/** The title's meaningful words, lowercased — what the FTS 'A' weight gets.
    Pure and exported for the test.

    The digit rule is the load-bearing part: "E6", "P8", "R32" are two or
    three characters and are EXACTLY what a tech types into search — a plain
    minimum-length filter throws away the best keyword in the title while
    keeping "the". Anything carrying a digit stays regardless of length. */
export function keywordsFromTitle(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => /\d/.test(w) || w.length >= 3)
    ),
  ].slice(0, 10);
}

/* ── the admin queue ─────────────────────────────────────────────────── */

export type FieldNoteRow = {
  id: string;
  title: string;
  body: string;
  heading: string | null;
  authorName: string | null;
  createdAt: string;
};

/** Unreviewed field notes, newest first — what Admin's "N new entries" is. */
export async function listUnreviewedFieldNotes(orgId: string, limit = 50): Promise<FieldNoteRow[]> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("id, title, source, created_at, kb_chunks(content, heading)")
    .eq("org_id", orgId)
    .eq("category", "field")
    .is("reviewed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const chunks = (r.kb_chunks ?? []) as { content: string; heading: string | null }[];
    return {
      id: String(r.id),
      title: String(r.title),
      body: chunks[0]?.content ?? "",
      heading: chunks[0]?.heading ?? null,
      authorName: (r.source as string) ?? null,
      createdAt: String(r.created_at),
    };
  });
}

/** How many are waiting — the Admin card's number. */
export async function countUnreviewedFieldNotes(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("kb_documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("category", "field")
    .is("reviewed_at", null);
  return count ?? 0;
}
