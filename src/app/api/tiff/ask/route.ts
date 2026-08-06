import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { documentTitleOf, streamAnswer, type AnswerMode } from "@/lib/tiff/answer";
import type { AskEvent, AskSourceItem, AskTurn } from "@/lib/tiff/ask-client";
import { citationOrder } from "@/lib/tiff/rank";
import { recordQuestion, retrieveForQuestion } from "@/lib/tiff/retrieve";

/* Asking Tiff. The repo's first streaming response.

   A ROUTE HANDLER RATHER THAN A SERVER FUNCTION, and for a different reason
   than the ingest route's: an action returns a value, once. This one has to
   deliver the answer AS IT IS WRITTEN, plus the retrieval trace before it and
   the sources after — which is a stream of events, not a return value. The
   long ceiling is a route-segment option besides, and raising it for an action
   would raise it for every action on the screen.

   NDJSON, ONE OBJECT PER LINE. Ordered so the screen can render honestly at
   every moment: `trace` (research mode, before a word is written) → `miss` if
   the library had nothing → `delta`s → `sources` renumbered into the order the
   answer actually cited them → `done`. A failure at any point is one `err`
   with a sentence from the house ladder, never vendor text, and never a
   half-answer left hanging with no explanation.

   GATED `tiff`, THE READ TIER. Asking is what the library is for, so
   every role that can see the assistant can use it; spending the org's page
   allowance (ingest) is the tier above. A route handler is reachable by direct
   POST, so this gate is the gate. */

export const maxDuration = 120;

/** A question, not an essay. Past this it is a document, and there is a
    library for those. */
const QUESTION_MAX = 2_000;

/** Turns of context. Eight is four exchanges — enough for "and in heating?" to
    still mean something, short of re-billing an afternoon on every question. */
const HISTORY_TURNS = 8;

/** Per turn. A long prior answer is trimmed rather than dropped. */
const HISTORY_TEXT_MAX = 4_000;

const NO_ACCESS = "You don't have access to Tiff.";
const UNREADABLE = "That question couldn't be read.";
const FAILED = "Tiff couldn't answer that just now. Try again.";

type AskBody = { question: string; research: boolean; history: AskTurn[] };

/* Everything the browser sent, clamped. The history especially: it is replayed
   into the model as prior turns, so it is the one input a caller could use to
   put words in Tiff's mouth — text only, capped in both directions, and the
   role narrowed to the two we render. */
function shapeBody(raw: unknown): AskBody | null {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const question = typeof body.question === "string" ? body.question.trim().slice(0, QUESTION_MAX) : "";
  if (!question) return null;

  const turns = Array.isArray(body.history) ? body.history : [];
  const history: AskTurn[] = [];
  for (const turn of turns.slice(-HISTORY_TURNS)) {
    const row = (turn && typeof turn === "object" ? turn : {}) as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim().slice(0, HISTORY_TEXT_MAX) : "";
    if (!text) continue;
    history.push({ role: row.role === "assistant" ? "assistant" : "user", text });
  }

  return { question, research: body.research === true, history };
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await can("tiff"))) return Response.json({ error: NO_ACCESS }, { status: 403 });

  let body: AskBody | null;
  try {
    body = shapeBody(await request.json());
  } catch {
    return Response.json({ error: UNREADABLE }, { status: 400 });
  }
  if (!body) return Response.json({ error: UNREADABLE }, { status: 400 });

  const { question, research, history } = body;

  /* The client going away has to reach the model call, or a closed tab leaves
     Opus writing an answer nobody will read for the rest of the invocation. */
  const abort = new AbortController();
  const stop = () => abort.abort();
  request.signal.addEventListener("abort", stop, { once: true });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (event: AskEvent) => {
        if (!open || abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the reader hung up between the check and the write
          open = false;
        }
      };

      try {
        let mode: AnswerMode = "general";
        let documents: { title: string; content: string }[] = [];
        let sources: AskSourceItem[] = [];

        if (research) {
          const found = await retrieveForQuestion(orgId, question);
          write({
            t: "trace",
            categories: found.trace.categories,
            winners: found.trace.winners,
            terms: found.trace.terms,
          });

          if (found.chunks.length === 0) {
            // honest miss: say so on the screen AND tell the model to open
            // the answer by saying it, so the two can never disagree
            mode = "miss";
            write({ t: "miss" });
          } else {
            mode = "research";
            documents = found.chunks.map((c) => ({
              title: documentTitleOf(c),
              /* A field note's heading IS its provenance — who learned it,
                 when, on what job — and the model can only weigh crew
                 knowledge against a manual if it can see which is which. A
                 manual chunk's heading is just a section title; content
                 alone was always enough there and stays that way. */
              content:
                c.category === "field" && c.heading ? `${c.heading}\n${c.content}` : c.content,
            }));
            sources = found.sources;
          }

          // counted, never awaited — the answer doesn't wait on bookkeeping
          void recordQuestion(orgId);
        }

        const cited: number[] = [];
        let failed = false;

        for await (const event of streamAnswer({
          question,
          history,
          documents,
          mode,
          signal: abort.signal,
        })) {
          if (event.type === "delta") write({ t: "delta", text: event.text });
          else if (event.type === "citation") cited.push(event.documentIndex);
          else if (event.type === "truncated") write({ t: "trunc" });
          else if (event.type === "error") {
            write({ t: "err", message: event.message });
            failed = true;
          }
        }

        if (!failed) {
          /* Renumbered into the order the ANSWER used them, and anything it
             never cited drops off — a chip under an answer claims the answer
             came from that page. */
          const items = citationOrder(sources, cited).map((source, i) => ({ ...source, n: i + 1 }));
          if (items.length > 0) write({ t: "sources", items });
          write({ t: "done" });
        }
      } catch {
        // never the vendor's words, and never a stream that just stops
        write({ t: "err", message: FAILED });
      } finally {
        open = false;
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          /* already closed by a cancelled reader */
        }
      }
    },

    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // a proxy that buffers this response turns a stream back into a wait
      "X-Accel-Buffering": "no",
    },
  });
}
