import { auth0 } from "@/lib/auth0";
import { answer, shapeAsk, type AskBody } from "@/lib/brain/turn";
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

const NO_ACCESS = "There's nothing you have access to ask about.";
const UNREADABLE = "That question couldn't be read.";
const FAILED = "That couldn't be answered just now. Try again.";

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
    body = shapeAsk(await request.json());
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
  const shaped = body;

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
        for await (const event of answer(viewer, shaped, { signal: abort.signal })) {
          if (event.type === "delta") write({ t: "delta", text: event.text });
          else if (event.type === "tool") write({ t: "tool", name: event.name, label: event.label });
          else if (event.type === "error") write({ t: "err", message: event.message });
          else if (event.type === "screen") write({ t: "screen", href: event.href, label: event.label });
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
