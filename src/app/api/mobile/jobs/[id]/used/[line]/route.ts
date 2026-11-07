import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { changeUsed, type Change } from "@/lib/mobile/used";
import { qtyOf } from "@/lib/mobile/used-plan";

/* ONE LINE OF A JOB'S LIST CHANGED (lib/mobile/used), by anyone on the job
   (Isaac, 3 November 2026: the shared list): a repeat settled (in total,
   more on top, leave it, or not sure), its amount, which of the book's
   items it is, or off the list. Each change goes in the line's history
   under the person's name. The job sheet's tier, as the list itself. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; line: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  const { id, line } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(line)) return no(400, "Which line?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id.trim().slice(0, 80));
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let change: Change;
  if (input?.do === "settle") {
    const said = qtyOf(input.said);
    const how = input.how;
    if (said === null || (how !== "total" && how !== "more" && how !== "leave" && how !== "open")) return no(400, "How should it be settled?");
    change = { do: "settle", said, how };
  } else if (input?.do === "amount") {
    const qty = qtyOf(input.qty);
    if (qty === null) return no(400, "How many?");
    change = { do: "amount", qty };
  } else if (input?.do === "pick" && typeof input.supplierKey === "string" && typeof input.code === "string") {
    change = { do: "pick", supplierKey: input.supplierKey, code: input.code };
  } else if (input?.do === "off") {
    change = { do: "off" };
  } else return no(400, "What should change?");
  try {
    const done = await changeUsed(ctx, parentRemoteId, line, change);
    return "error" in done ? no(done.status, done.error) : ok(done);
  } catch (err) {
    console.error(`[mobile] couldn't change a line: ${err instanceof Error ? err.message : String(err)}`);
    return no(500, "Couldn't change that. Try again.");
  }
}
