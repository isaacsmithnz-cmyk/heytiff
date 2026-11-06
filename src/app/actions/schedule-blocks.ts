"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";
import { createBlock, placeBlock, removeBlock, unplaceBlock, type BlockPlace, type BlockResult } from "@/lib/schedule/blocks-store";

/* BLOCK OUT TIME on the Schedule (Isaac, 6 November 2026, "Build it" on
   https://claude.ai/artifact/9BSz3k2q6MYZbb7Ua7PhUL, option B): Block out
   time beside the Jobs panel's title makes a card in Jobs (what, where, how
   long); it's dragged onto someone like a job, and the toast's Undo puts it
   back. Running the board is `workboard_manage`'s, as booking is, so these
   are too. lib/schedule/blocks-store does the work. */

const REFUSED = "You can't block out time here.";

async function gate(): Promise<{ ok: true; orgId: string; by: string | null } | { ok: false; error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { ok: false, error: REFUSED };
  if (!(await can("workboard_manage"))) return { ok: false, error: REFUSED };
  return { ok: true, orgId, by: await staffProfileIdFor(orgId, userId).catch(() => null) };
}

/** The person's press, for the copy on ServiceM8's board; none where leave doesn't go there. */
async function press() {
  if (!sm8LeaveAllowed()) return null;
  const { sm8PressFromSession } = await import("@/lib/integrations/sm8-press");
  return sm8PressFromSession().catch(() => null);
}

const refresh = () => revalidatePath("/dashboard/schedule");

/** A new block, into Jobs. */
export async function makeScheduleBlock(input: { what: string; where: string; minutes: number }): Promise<BlockResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await createBlock(g.orgId, g.by, { what: input?.what, where: input?.where, minutes: input?.minutes }, null);
  if (r.ok) refresh();
  return r;
}

/** A block in Jobs, dropped on a person's day. */
export async function placeScheduleBlock(id: string, place: BlockPlace): Promise<BlockResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await placeBlock(g.orgId, String(id ?? ""), { staffUuid: String(place?.staffUuid ?? ""), day: String(place?.day ?? ""), startMin: Number(place?.startMin) }, await press());
  if (r.ok) refresh();
  return r;
}

/** A placed block, back into Jobs. */
export async function unplaceScheduleBlock(id: string): Promise<BlockResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await unplaceBlock(g.orgId, String(id ?? ""), await press());
  if (r.ok) refresh();
  return r;
}

/** A block taken away, from a day or from Jobs. */
export async function removeScheduleBlock(id: string): Promise<BlockResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await removeBlock(g.orgId, String(id ?? ""), await press());
  if (r.ok) refresh();
  return r;
}
