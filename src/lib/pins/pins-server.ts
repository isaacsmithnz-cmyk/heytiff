import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { PIN_MAX, type Pin } from "./pins";
import type { RecordKind, RecordRef } from "@/lib/records/ref";

/* A person's pinned records (pins.ts says why). Service role, by org and
   sign-in: a pin is only ever its owner's. The callers gate. */

export type PinOwner = { orgId: string; userSub: string };

type Row = { kind: RecordKind; ref_id: string; title: string; sub: string | null };

/** Newest first; [] when there are none, or the table can't be read (a
    sidebar without its pins still works). */
export async function readPins(o: PinOwner): Promise<Pin[]> {
  const { data, error } = await supabaseAdmin
    .from("nav_pins")
    .select("kind, ref_id, title, sub")
    .eq("org_id", o.orgId)
    .eq("user_sub", o.userSub)
    .order("pinned_at", { ascending: false })
    .limit(PIN_MAX);
  if (error || !data) return [];
  return (data as Row[]).map((r) => ({ ref: { kind: r.kind, id: r.ref_id }, title: r.title, sub: r.sub }));
}

/** Pin it, or move it to the top if it is already pinned; past PIN_MAX the oldest go. */
export async function savePin(o: PinOwner, pin: Pin): Promise<boolean> {
  const { error } = await supabaseAdmin.from("nav_pins").upsert(
    { org_id: o.orgId, user_sub: o.userSub, kind: pin.ref.kind, ref_id: pin.ref.id, title: pin.title, sub: pin.sub, pinned_at: new Date().toISOString() },
    { onConflict: "org_id,user_sub,kind,ref_id" },
  );
  if (error) return false;
  const { data } = await supabaseAdmin
    .from("nav_pins")
    .select("kind, ref_id")
    .eq("org_id", o.orgId)
    .eq("user_sub", o.userSub)
    .order("pinned_at", { ascending: false })
    .range(PIN_MAX, PIN_MAX + 50);
  for (const r of (data ?? []) as Pick<Row, "kind" | "ref_id">[]) await dropPin(o, { kind: r.kind, id: r.ref_id });
  return true;
}

export async function dropPin(o: PinOwner, ref: RecordRef): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("nav_pins")
    .delete()
    .eq("org_id", o.orgId)
    .eq("user_sub", o.userSub)
    .eq("kind", ref.kind)
    .eq("ref_id", ref.id);
  return !error;
}
