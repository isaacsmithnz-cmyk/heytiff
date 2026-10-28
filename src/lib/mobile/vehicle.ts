import "server-only";

import { addLog, editLog, type LogEdit } from "@/app/actions/fleet";
import { todayInAu } from "@/lib/au-dates";
import { fmtCost, fmtKm, type VehicleLog } from "@/components/fleet/logic";
import { choicesOf, type VehicleChoice } from "@/lib/mobile/vehicle-choices";
import { getOwnVehicle, listLogs, listVehiclePicker, staffProfileIdFor } from "@/lib/fleet/query";
import {
  headFacts,
  issueGroups,
  issueLine,
  issueName,
  lastFuel,
  renewalRows,
  serviceName,
  serviceRows,
  statusWord,
  vehicleTitle,
  type FactRow,
  type Word,
} from "@/lib/fleet/vehicle-page";
import { orgExpiryWindow } from "@/lib/org/query";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

/* YOUR VEHICLE ON THE PHONE (Isaac, 28 October 2026, "Yes, build it" on
   https://claude.ai/artifact/1FjPQpZ1uVmmiL9BmCKkQx): the web's vehicle page
   as its driver sees it (lib/fleet/vehicle-page-data's driver lens), its own
   words for every fact (lib/fleet/vehicle-page), and no money, paper or
   renewals to change. Logging is the web's own actions run as the phone's
   person: a reading and an issue (addLog), a correction of your own entry
   (editLog); fuel is Expense claims' fuel (lib/mobile/expenses' logFuel).
   Off the road, fuel and readings pause and an issue still goes in, as
   addLog keeps it. Ungated, like the web's: your own vehicle is yours. */

export type PhoneEntry = {
  id: string;
  kind: VehicleLog["kind"];
  /** "Fuel", "Kilometres", "Service", "Issue" */
  word: string;
  when: string;
  line: string;
  /** yours, so you can correct it */
  mine: boolean;
  edited: boolean;
  /** what a correction starts from */
  litres: number | null;
  cost: number | null;
  odo: number | null;
  station: string | null;
  note: string | null;
};

export type PhoneVehicle = {
  vehicle: null | {
    id: string;
    title: string;
    plate: string | null;
    plateState: string | null;
    head: string;
    status: Word;
    offroad: boolean;
    motorised: boolean;
    odometer: number;
    service: FactRow[];
    renewals: { label: string; date: string | null; word: Word | null }[];
    lastFuel: { when: string; line: string } | null;
    issues: { id: string; name: string; line: string }[];
    entries: PhoneEntry[];
  };
  /** every vehicle fuel or a reading can go on: yours, and the pool */
  vehicles: VehicleChoice[];
  canFile: boolean;
};

const WORD: Record<VehicleLog["kind"], string> = { fuel: "Fuel", odo: "Kilometres", service: "Service", issue: "Issue" };
const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

/** One entry as Every entry lists it. */
export function entryOf(l: VehicleLog, me: string | null): PhoneEntry {
  const at = typeof l.odo === "number" ? `at ${fmtKm(l.odo)} km` : null;
  const line =
    l.kind === "fuel"
      ? join([typeof l.litres === "number" ? `${l.litres} litres` : null, typeof l.cost === "number" ? fmtCost(l.cost) : null, l.station, at]) || "Fuel logged"
      : l.kind === "odo"
        ? typeof l.odo === "number"
          ? `${fmtKm(l.odo)} km`
          : "A reading"
        : l.kind === "service"
          ? join([serviceName(l), at])
          : join([issueName(l), l.hasReceipt ? "with a photo" : null, l.status === "resolved" ? "fixed" : null]);
  return {
    id: l.id,
    kind: l.kind,
    word: WORD[l.kind],
    when: l.when,
    line,
    mine: me !== null && l.staffId === me,
    edited: !!l.edited,
    litres: l.litres ?? null,
    cost: l.cost ?? null,
    odo: l.odo ?? null,
    station: l.station ?? null,
    note: l.note ?? null,
  };
}

export async function readPhoneVehicle(ctx: MobileCtx): Promise<PhoneVehicle> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  const [own, picker, { warnDays }] = await Promise.all([
    getOwnVehicle(ctx.orgId, staffId).catch(() => null),
    listVehiclePicker(ctx.orgId).catch(() => []),
    orgExpiryWindow(ctx.orgId),
  ]);
  const vehicles = choicesOf(picker, own?.id ?? null);
  if (!own) return { vehicle: null, vehicles, canFile: !!staffId };

  const today = todayInAu();
  const logs = await listLogs(ctx.orgId, { vehicleId: own.id });
  const fuel = own.motorised ? lastFuel(logs) : null;
  return {
    vehicle: {
      id: own.id,
      title: vehicleTitle(own),
      plate: own.plate || null,
      plateState: own.plateState ?? null,
      head: headFacts(own, "you"),
      status: statusWord(own.status),
      offroad: own.status === "offroad",
      motorised: own.motorised,
      odometer: own.odometer,
      service: serviceRows(own, logs, today, warnDays),
      /* the driver reads the renewals; the register renews them */
      renewals: renewalRows(own, [], today, warnDays).map((r) => ({ label: r.label, date: r.date, word: r.word ?? null })),
      lastFuel: fuel ? { when: fuel.when, line: fuel.line } : null,
      issues: issueGroups(logs).open.map((l) => ({ id: l.id, name: issueName(l), line: issueLine(l) })),
      entries: [...logs].sort((a, b) => a.ago - b.ago).map((l) => entryOf(l, staffId)),
    },
    vehicles,
    canFile: !!staffId,
  };
}

type Done<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const bad = (error: string, status = 400): Done<never> => ({ ok: false, status, error });
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Kilometres: a reading on its own, held to addLog's never-backwards rule. */
export async function logReading(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const vehicleId = str(body.vehicleId, 60);
  const odo = num(body.odo);
  if (!vehicleId) return bad("Which vehicle?");
  if (odo === null || odo <= 0) return bad("Enter the odometer reading.");
  const r = await actAsPhoneUser(ctx, () => addLog({ vehicleId, kind: "odo", odo: Math.round(odo), source: "manual" }));
  return r.ok ? { ok: true, value: null } : bad(r.error);
}

/** Report an issue: in the driver's words. */
export async function reportIssue(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const vehicleId = str(body.vehicleId, 60);
  const note = str(body.note, 500);
  if (!vehicleId) return bad("Which vehicle?");
  if (!note) return bad("Say what's wrong.");
  /* the photo, when one was taken, uploaded as an issue_photo and adopted by this issue */
  const photo = str(body.photoDocumentId, 60);
  const r = await actAsPhoneUser(ctx, () => addLog({ vehicleId, kind: "issue", note, ...(photo ? { receiptDocumentId: photo } : {}) }));
  return r.ok ? { ok: true, value: null } : bad(r.error);
}

/** Correct your own entry: editLog keeps every rule the first save kept, and refuses someone else's. */
export async function fixEntry(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const id = str(body.id, 60);
  if (!id) return bad("Which entry?");
  const patch: LogEdit = {};
  for (const k of ["litres", "cost", "odo"] as const) {
    if (body[k] === undefined) continue;
    const n = num(body[k]);
    if (n === null) return bad("That isn't a number.");
    patch[k] = k === "odo" ? Math.round(n) : n;
  }
  if (typeof body.station === "string") patch.station = str(body.station, 120);
  if (typeof body.note === "string") patch.note = str(body.note, 500);
  /* A FILL OR A SERVICE KEEPS ITS TAX HALF. editLog re-reads the GST, the
     ABN and the docket's date from what it's sent, as the web's correction
     always sends them; the phone corrects the litres or the cost, so the
     stored three go with it, or a correction would wipe the GST credit and
     move the claim's date (the review of 29 October 2026). */
  const { data: row } = await supabaseAdmin
    .from("vehicle_logs")
    .select("kind, gst, supplier_abn, logged_on")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  const stored = row as { kind: string; gst: number | string | null; supplier_abn: string | null; logged_on: string | null } | null;
  if (stored && (stored.kind === "fuel" || stored.kind === "service")) {
    if (stored.gst !== null && stored.gst !== undefined) patch.gst = Number(stored.gst);
    if (stored.supplier_abn) patch.abn = stored.supplier_abn;
    if (stored.logged_on) patch.purchasedOn = stored.logged_on;
  }
  const r = await actAsPhoneUser(ctx, () => editLog(id, patch));
  return r.ok ? { ok: true, value: null } : bad(r.error);
}
