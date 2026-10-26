import { answer, shapeAsk, type AskBody } from "@/lib/brain/turn";
import { toolsFor } from "@/lib/tiff/registry";
import { viewerForUser } from "@/lib/tiff/registry/viewer";
import { requireMobile } from "@/lib/mobile/auth";
import { phonePath } from "@/lib/mobile/screens";

/* TALKING TO TIFF from the phone: the web's own brain (/api/brain/ask, its
   `answer` loop and its tools, gated per tool by the viewer's capabilities),
   for the person the phone's token check verified. The same NDJSON wire:
   `tool` as she reaches for a reader, `delta` as she writes, one `err` on a
   failure, `done`. Where she'd take you to a page, `screen` carries the
   phone's own screen for it (lib/mobile/screens), and nothing where the
   phone has none; her quick prices and design changes stay on the web. */

export const maxDuration = 120;

const NO_ACCESS = "There's nothing you have access to ask about.";
const UNREADABLE = "That question couldn't be read.";
const FAILED = "That couldn't be answered just now. Try again.";

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const viewer = await viewerForUser(ctx.orgId, ctx.userId);
  const tools = toolsFor(viewer);
  if (!tools.some((t) => t.risk === "read")) return no(403, NO_ACCESS);

  let body: AskBody | null;
  try {
    body = shapeAsk(await request.json());
  } catch {
    return no(400, UNREADABLE);
  }
  if (!body) return no(400, UNREADABLE);

  /* the phone going away reaches the model call */
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
          else if (event.type === "screen") {
            const path = phonePath(event.href);
            if (path) write({ t: "screen", path, label: event.label });
          } else if (event.type === "done") write({ t: "done" });
        }
      } catch {
        write({ t: "err", message: FAILED });
      } finally {
        open = false;
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // already closed by the phone going away
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
