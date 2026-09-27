import { auth0 } from "@/lib/auth0";
import { streamBrainAnswer, type AskHistoryTurn } from "@/lib/brain/ask";
import { TARGET_KINDS } from "@/lib/brain/tools";
import { toolsFor } from "@/lib/tiff/registry";
import { viewerForUser } from "@/lib/tiff/registry/viewer";

/* Asking the brain. Same wire as /api/tiff/ask — NDJSON, one event per line,
   ordered so the screen renders honestly at every moment: `tool` chips as
   the loop reaches for its hands, `delta`s as the answer is written, one
   `err` with a sentence on any failure, `done`. A route handler rather than
   an action for the same reason tiff's is: an action returns once, and this
   is a stream.

   THE GATE IS PER-TOOL, NOT PER-ROUTE. The viewer's capabilities decide
   which readers the loop may hold (toolsFor): `workboard` unlocks the job
   and task tools, `tiff` unlocks the knowledge base. Someone with neither
   gets a 403 — there is nothing they could ask about. The same read behind
   a screen gate must not be reachable by asking. */

export const maxDuration = 120;

const QUESTION_MAX = 1_000;

/** Turns of the Tiff modal's conversation replayed ahead of the question.
    Six is three exchanges: enough for "and the one at Smith St?" to mean
    something, short of re-billing the whole note on every ask. */
const HISTORY_TURNS = 6;

/** Per turn. A long earlier answer is trimmed rather than dropped. */
const HISTORY_TEXT_MAX = 4_000;
const NO_ACCESS = "There's nothing you have access to ask about.";
const UNREADABLE = "That question couldn't be read.";
const FAILED = "That couldn't be answered just now. Try again.";

type AskBody = {
  question: string;
  target?: { kind: (typeof TARGET_KINDS)[number]; id: string };
  targetLabel?: string;
  history: AskHistoryTurn[];
};

/* The history is replayed into the model as earlier turns, so it is the one
   input a caller could use to put words in Tiff's mouth: text only, the last
   few, each capped, and only the two voices the modal has. A turn from
   anyone else is dropped, not relabelled. Not exported: a route file may
   export only what Next reads. */
function shapeHistory(raw: unknown): AskHistoryTurn[] {
  const out: AskHistoryTurn[] = [];
  for (const turn of Array.isArray(raw) ? raw : []) {
    const row = (turn && typeof turn === "object" ? turn : {}) as Record<string, unknown>;
    if (row.who !== "you" && row.who !== "tiff") continue;
    const text = typeof row.text === "string" ? row.text.trim().slice(0, HISTORY_TEXT_MAX) : "";
    if (!text) continue;
    out.push({ who: row.who, text });
  }
  return out.slice(-HISTORY_TURNS);
}

function shapeBody(raw: unknown): AskBody | null {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const question =
    typeof body.question === "string" ? body.question.trim().slice(0, QUESTION_MAX) : "";
  if (!question) return null;

  /* A target is whatever job_history can read — the system prompt tells the
     loop to call it with this — and nothing else. A ServiceM8 job sheet aims
     the modal at `job`, so a list without it drops the target in silence and
     "what's wrong with this job?" arrives about no job at all. */
  let target: AskBody["target"];
  const t = (body.target ?? null) as Record<string, unknown> | null;
  const kind = TARGET_KINDS.find((k) => k === t?.kind);
  if (kind && typeof t?.id === "string" && t.id) {
    target = { kind, id: t.id };
  }

  const targetLabel =
    typeof body.targetLabel === "string" ? body.targetLabel.trim().slice(0, 200) : undefined;

  return {
    question,
    target,
    targetLabel: targetLabel || undefined,
    history: shapeHistory(body.history),
  };
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!session || !orgId || !userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  /* Who is asking, read once: their capabilities decide which tools the loop
     may hold (the registry's gates), exactly as they decide which screens
     they may see. */
  const viewer = await viewerForUser(orgId, userId);
  const tools = toolsFor(viewer);
  if (!tools.some((t) => t.risk === "read")) return Response.json({ error: NO_ACCESS }, { status: 403 });

  let body: AskBody | null;
  try {
    body = shapeBody(await request.json());
  } catch {
    return Response.json({ error: UNREADABLE }, { status: 400 });
  }
  if (!body) return Response.json({ error: UNREADABLE }, { status: 400 });

  /* The client going away has to reach the model call — a closed sheet must
     not leave Opus reading the task list to nobody. */
  const abort = new AbortController();
  const stop = () => abort.abort();
  request.signal.addEventListener("abort", stop, { once: true });

  const encoder = new TextEncoder();
  const { question, target, targetLabel, history } = body;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (event: Record<string, unknown>) => {
        if (!open || abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      try {
        for await (const event of streamBrainAnswer({
          viewer,
          question,
          tools,
          targetLabel,
          targetRef: target,
          todayISO: viewer.today,
          signal: abort.signal,
          history,
        })) {
          if (event.type === "delta") write({ t: "delta", text: event.text });
          else if (event.type === "tool") write({ t: "tool", name: event.name, label: event.label });
          else if (event.type === "error") write({ t: "err", message: event.message });
          else if (event.type === "done") write({ t: "done" });
        }
      } catch {
        write({ t: "err", message: FAILED });
      } finally {
        open = false;
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // already closed by the reader going away
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}
