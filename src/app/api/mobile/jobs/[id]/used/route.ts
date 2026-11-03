import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { addUsed, dayFor, jobHeld, readUsed } from "@/lib/mobile/used";
import { qtyOf, unitOf, type Choice, type Ready } from "@/lib/mobile/used-plan";

/* WHAT WAS USED ON A JOB, ONE LIST A DAY (lib/mobile/used): GET reads the
   day's list, POST puts what someone said on it, each new thing a line and
   a repeat of one already there a question (Isaac, 3 November 2026: "Yes,
   add the table and build the wrap-up with the list"). The job sheet's own
   tier, `workboard`, as a note on the job; quantities only, no prices. The
   job is a choice the phone hands in, so it's only ever the caller's own
   workspace's, and one its mirror holds. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

async function jobOf(orgId: string, raw: string): Promise<string | null> {
  const id = raw.trim().slice(0, 80);
  if (!id) return null;
  const { parentRemoteId } = await resolveJobCard(orgId, id);
  return (await jobHeld(orgId, parentRemoteId)) ? parentRemoteId : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = await jobOf(ctx.orgId, (await params).id);
  if (!job) return no(404, "That job isn't here.");
  const day = await dayFor(ctx.orgId, new URL(request.url).searchParams.get("day"));
  if (!day) return no(400, "Which day?");
  return ok(await readUsed(ctx, job, day));
}

const choicesOf = (raw: unknown): Choice[] | null => {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => typeof c.supplierKey === "string" && typeof c.code === "string" && typeof c.name === "string")
    .slice(0, 4)
    .map((c) => ({ supplierKey: String(c.supplierKey), code: String(c.code), name: String(c.name).slice(0, 200), hint: typeof c.hint === "string" ? c.hint.slice(0, 60) : "" }));
  return out.length ? out : null;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = await jobOf(ctx.orgId, (await params).id);
  if (!job) return no(404, "That job isn't here.");
  const input = (await request.json().catch(() => null)) as { day?: unknown; words?: unknown; lines?: unknown } | null;
  const day = await dayFor(ctx.orgId, input?.day);
  if (!day) return no(400, "Which day?");
  const raw = Array.isArray(input?.lines) ? (input!.lines as Record<string, unknown>[]).slice(0, 30) : [];
  const lines: Ready[] = [];
  for (const l of raw) {
    const qty = qtyOf(l?.qty);
    const name = typeof l?.name === "string" ? l.name.trim() : "";
    if (!name) return no(400, "A line has no name.");
    if (qty === null) return no(400, `How many ${name}?`);
    const supplierKey = typeof l.supplierKey === "string" && l.supplierKey ? l.supplierKey : null;
    const code = supplierKey && typeof l.code === "string" && l.code ? l.code : null;
    lines.push({
      said: typeof l.said === "string" ? l.said.slice(0, 300) : "",
      name: name.slice(0, 200),
      qty,
      unit: unitOf(l.unit),
      supplierKey: code ? supplierKey : null,
      code,
      choices: code ? null : choicesOf(l.choices),
    });
  }
  if (!lines.length) return no(400, "Nothing to add.");
  try {
    return ok(await addUsed(ctx, job, day, typeof input?.words === "string" ? input.words : "", lines));
  } catch (err) {
    console.error(`[mobile] couldn't add to the list: ${err instanceof Error ? err.message : String(err)}`);
    return no(500, "Couldn't add that to the list. Try again.");
  }
}
