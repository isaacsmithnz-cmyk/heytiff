/**
 * @jest-environment node
 */
/* FILLING IN THE LIBRARY'S MAKERS AND EDITIONS, ONCE. Opt-in, never part of
   `npm test`; a person starts it, and it never runs on a page load.

       LIBRARY_EDITIONS=count npm run editions:library   what it would read, and roughly what it costs
       LIBRARY_EDITIONS=write npm run editions:library   reads each cover and fills the empty fields

   Needs the Supabase service role, and for `write` ANTHROPIC_API_KEY: the
   main checkout's .env.local. `count` spends nothing. `write` asks Haiku once
   a document (../../imprint), about a fifth of a cent each, and writes only
   into a maker or an edition nobody filled (`imprintPatch`). */

import { IMPRINT_CHARS, imprintPatch, readImprint } from "../../imprint";

const MODE = process.env.LIBRARY_EDITIONS;
/** Roughly what one cover costs on Haiku 5.5: ~2k tokens in, ~40 out. */
const CENTS_EACH = 0.2;

type Row = { id: string; org_id: string; title: string; source: string | null; edition: string | null; storage_ref: string | null };

/* imported when it runs: the client wants the service role at load, which
   `npm test` doesn't have, and this suite must load there to skip */
const admin = async () => (await import("@/lib/supabase-server")).supabaseAdmin;

async function missing(): Promise<Row[]> {
  const { data, error } = await (await admin())
    .from("kb_documents")
    .select("id, org_id, title, source, edition, storage_ref")
    .eq("status", "ready")
    .or("source.is.null,source.eq.,edition.is.null,edition.eq.");
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

/* The cover's words as the reading stored them: the passages from its first
   three pages (kb_chunks), so no PDF is opened again. A scanned cover has
   none, and is left as it is. */
async function coverOf(r: Row): Promise<string> {
  const { data } = await (await admin())
    .from("kb_chunks")
    .select("content, chunk_index")
    .eq("org_id", r.org_id)
    .eq("document_id", r.id)
    .lte("page_from", 3)
    .order("chunk_index", { ascending: true })
    .limit(8);
  return ((data ?? []) as { content: string }[]).map((c) => c.content).join("\n").slice(0, IMPRINT_CHARS);
}

const run = MODE === "count" || MODE === "write" ? it : it.skip;

describe("the Library's makers and editions", () => {
  run(
    `${MODE ?? "off"}: fills what nobody has`,
    async () => {
      const rows = await missing();
      console.log(`${rows.length} documents with no maker or no edition, about ${((rows.length * CENTS_EACH) / 100).toFixed(2)} USD to read.`);
      if (MODE !== "write") return;
      for (const r of rows) {
        const found = await readImprint(await coverOf(r));
        const patch = imprintPatch(r, found);
        if (Object.keys(patch).length) {
          const { error } = await (await admin()).from("kb_documents").update(patch).eq("org_id", r.org_id).eq("id", r.id);
          console.log(`${r.title}: ${error ? `not written, ${error.message}` : JSON.stringify(patch)}`);
        } else console.log(`${r.title}: nothing printed to take`);
      }
    },
    30 * 60 * 1000,
  );
});
