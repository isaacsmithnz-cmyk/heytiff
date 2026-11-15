import { ok, requireMobile } from "@/lib/mobile/auth";
import { readJobEquipment } from "@/lib/stock/stock-server";
import { jobMaterials, quoteOnly } from "@/lib/stock/materials";
import { addPicklistTo, listPicklistOf, setPickedOn } from "@/lib/workboard/picklist-server";

/* A JOB'S MATERIALS for the phone's job card, the web's On site Materials as
   one list (lib/stock/materials): the job's pick list with Stock's word on
   each unit and control, and the quote's units and controls the list doesn't
   have (Isaac, 15 November 2026: "Do the phone too"). GET reads it; POST
   ticks a row as loaded (`tick`, id + picked) or puts a quote's unit on the
   list ticked (`load`, key). Each hands back the list as it now stands.
   Behind `workboard`, as the web's job sheet is. */

const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

const read = async (orgId: string, job: string) => {
  const [items, stock] = await Promise.all([listPicklistOf(orgId, job), readJobEquipment(orgId, job)]);
  return { items, stock };
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = (await params).id.trim().slice(0, 80);
  if (!job) return no("Which job?", 400);
  const { items, stock } = await read(ctx.orgId, job);
  return ok({ rows: jobMaterials(items, stock) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = (await params).id.trim().slice(0, 80);
  if (!job) return no("Which job?", 400);
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (b.do === "tick" && typeof b.id === "string" && typeof b.picked === "boolean") {
    const { items } = await read(ctx.orgId, job);
    if (!items.some((i) => i.id === b.id)) return no("That isn't on this job's list.", 404);
    await setPickedOn(ctx.orgId, ctx.userId, b.id, b.picked);
  } else if (b.do === "load" && typeof b.key === "string") {
    const { items, stock } = await read(ctx.orgId, job);
    const r = quoteOnly(items, stock).find((x) => `q-${x.key}` === b.key);
    if (r) {
      const added = await addPicklistTo(ctx.orgId, ctx.userId, job, { kind: "material", name: r.title, qty: String(r.qty), sub: r.detail });
      await setPickedOn(ctx.orgId, ctx.userId, added.id, true);
    }
  } else return no("What should happen?", 400);
  const { items, stock } = await read(ctx.orgId, job);
  return ok({ rows: jobMaterials(items, stock) });
}
