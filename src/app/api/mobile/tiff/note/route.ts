import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { fileWithNote } from "@/lib/mobile/tiff-files";
import { tiffSays, type SayInput } from "@/lib/mobile/tiff-notes";

/* TIFF DOING THINGS from the phone: what you said, or your answer to her
   question, read and filed by the web's own note router, as you
   (lib/mobile/tiff-notes, run inside actAsPhoneUser). Behind the job
   sheet's own grant, `workboard`, as on the web. A question comes back as
   `ask`, for the phone to stream from /api/mobile/tiff as it does now.
   `files` are what was added with the plus: once the note's filed they go
   where it went (lib/mobile/tiff-files). */

export const maxDuration = 120;

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

const idsOf = (v: unknown) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === "string" && /^[0-9a-f-]{36}$/i.test(i)).slice(-5) : []);

function shape(b: Record<string, unknown> | null): SayInput | null {
  const noteId = str(b?.noteId, 80);
  switch (b?.do) {
    case "say": {
      const before = Array.isArray(b.before)
        ? b.before
            .slice(-12)
            .filter((t): t is { who: unknown; text: unknown } => !!t && typeof t === "object")
            .map((t) => ({ who: t.who === "tiff" ? ("tiff" as const) : ("you" as const), text: str(t.text, 4000) }))
        : [];
      const target = typeof b.jobUuid === "string" && b.jobUuid ? { kind: "job" as const, id: b.jobUuid.slice(0, 80) } : undefined;
      return {
        do: "say",
        words: str(b.words, 8000),
        source: b.source === "voice" ? "voice" : "text",
        before,
        ...(target ? { target } : {}),
        ...(idsOf(b.files).length > 0 ? { withFiles: true } : {}),
      };
    }
    case "reply":
      return noteId ? { do: "reply", noteId, words: str(b.words, 500) } : null;
    case "job": {
      const t = b.target as { kind?: unknown; id?: unknown } | undefined;
      return noteId && t?.kind === "job" && typeof t.id === "string" ? { do: "job", noteId, target: { kind: "job", id: t.id.slice(0, 80) } } : null;
    }
    case "visit":
      return noteId ? { do: "visit", noteId, answer: str(b.answer, 80) } : null;
    case "undo":
      return noteId ? { do: "undo", noteId } : null;
    case "away":
      return noteId ? { do: "away", noteId } : null;
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const input = shape(body);
  if (!input) return no(400, "Say something first.");
  const turns = await actAsPhoneUser(ctx, () => tiffSays(input));
  const ids = idsOf(body?.files);
  const filed = turns.find((t) => t.kind === "filed");
  if (filed?.kind === "filed" && ids.length > 0) {
    const line = await fileWithNote(ctx, await sm8PressFromMobile(ctx), filed.noteId, ids).catch(() => null);
    if (line) turns.push({ kind: "said", say: line, failed: false });
  }
  return ok({ turns });
}
