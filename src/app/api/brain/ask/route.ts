import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { streamBrainAnswer } from "@/lib/brain/ask";
import { toolsFor } from "@/lib/brain/tools";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";

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
const NO_ACCESS = "There's nothing you have access to ask about.";
const UNREADABLE = "That question couldn't be read.";
const FAILED = "That couldn't be answered just now. Try again.";

type AskBody = {
  question: string;
  target?: { kind: "project" | "visit" | "agreement"; id: string };
  targetLabel?: string;
};

function shapeBody(raw: unknown): AskBody | null {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const question =
    typeof body.question === "string" ? body.question.trim().slice(0, QUESTION_MAX) : "";
  if (!question) return null;

  let target: AskBody["target"];
  const t = (body.target ?? null) as Record<string, unknown> | null;
  if (
    t &&
    (t.kind === "project" || t.kind === "visit" || t.kind === "agreement") &&
    typeof t.id === "string" &&
    t.id
  ) {
    target = { kind: t.kind, id: t.id };
  }

  const targetLabel =
    typeof body.targetLabel === "string" ? body.targetLabel.trim().slice(0, 200) : undefined;

  return { question, target, targetLabel: targetLabel || undefined };
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const caps = new Set<string>();
  const [workboard, tiff] = await Promise.all([can("workboard"), can("tiff")]);
  if (workboard) caps.add("workboard");
  if (tiff) caps.add("tiff");
  const tools = toolsFor(caps);
  if (tools.length === 0) return Response.json({ error: NO_ACCESS }, { status: 403 });

  let body: AskBody | null;
  try {
    body = shapeBody(await request.json());
  } catch {
    return Response.json({ error: UNREADABLE }, { status: 400 });
  }
  if (!body) return Response.json({ error: UNREADABLE }, { status: 400 });

  const tz = await getSm8Timezone(orgId);

  /* The client going away has to reach the model call — a closed sheet must
     not leave Opus reading the task list to nobody. */
  const abort = new AbortController();
  const stop = () => abort.abort();
  request.signal.addEventListener("abort", stop, { once: true });

  const encoder = new TextEncoder();
  const { question, target, targetLabel } = body;

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
          orgId,
          question,
          tools,
          targetLabel,
          targetRef: target,
          todayISO: todayInZone(tz),
          signal: abort.signal,
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
