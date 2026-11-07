/* The wire contract of /api/tiff/ask: the events its NDJSON stream carries,
   one JSON object per line, and the shapes they hold.

   THE EVENT UNION LIVES HERE, not on the server, because it is what a reader
   has to handle — the route imports it as a type and is checked against it.
   The browser's reader of this stream went with the Library's ask
   (components/tiff/assistant.tsx asks the brain now, lib/brain/ask-client);
   the shapes stay because a stored answer still carries its sources
   (lib/tiff/threads.ts) and the retriever still makes them. */

import type { KbCategory } from "./files";

/** One turn of prior conversation, text only — no sources, no ids. */
export type AskTurn = { role: "user" | "assistant"; text: string };

/** A source under a researched answer, numbered in the order it was cited. */
export type AskSourceItem = {
  n: number;
  chunkId: string;
  docId: string;
  title: string;
  category: KbCategory;
  pageFrom: number;
  pageTo: number;
  /** The passage the answer was drawn from, for the peek panel. */
  excerpt: string;
};

export type AskTraceCategory = { hits: number; topDoc: string | null };

export type AskEvent =
  /** Research mode, after retrieval: where Tiff looked and what it found. */
  | {
      t: "trace";
      categories: Record<KbCategory, AskTraceCategory>;
      winners: KbCategory[];
      terms: string[];
    }
  /** Research mode, zero hits — the answer that follows is general knowledge. */
  | { t: "miss" }
  /** The asker named a document, it covered nothing, and the search widened to
      the rest of the library rather than dead-ending on one manual. */
  | { t: "widened" }
  | { t: "delta"; text: string }
  /** After the final message, citation-ordered. Uncited documents are absent. */
  | { t: "sources"; items: AskSourceItem[] }
  /** The answer hit the token ceiling and stops mid-thought. */
  | { t: "trunc" }
  | { t: "done" }
  | { t: "err"; message: string };
