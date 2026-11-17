import "server-only";

import { todayInAu } from "@/lib/au-dates";
import { fmtKm, serviceDue, SERVICE_WARN_KM, type Vehicle } from "@/components/fleet/logic";
import { RENEWAL_ROW } from "@/components/fleet/vehicle-modal/derive";
import { listFleetStaff, listLogs, listVehicles } from "@/lib/fleet/query";
import { nickname, type Word } from "@/lib/fleet/vehicle-page";
import { orgExpiryWindow } from "@/lib/org/query";
import { phoneVehicleOf, type PhoneVehicleBody } from "@/lib/mobile/vehicle";
import type { MobileCtx } from "@/lib/mobile/auth";

/* EVERY VEHICLE ON THE PHONE, for whoever holds the register (Isaac, 17
   November 2026, bug 8: "I should be able to see all vehicles and team
   members as I'm an owner or admin", then approval of
   https://claude.ai/artifact/DRmNT8juCWAiUGf57QtQsU). `assets_all` only, as
   the web's register is; the routes check it first (requireMobile).

   The list: the working fleet (the register's own: everything but sold),
   those whose rego, insurance, green slip or service is past or inside the
   org's window first, each with its one word, then the rest by name. One
   vehicle: Your vehicle's page for any of them, its driver named, and
   nothing to log or correct from it.

   The register is read at full width (listVehicles) and only the fields
   below leave: never its value, purchase, finance or Tiff's valuation. */

export type PhoneFleetRow = {
  id: string;
  /** the vehicle's own name, "ZUCKY"; its make and model with none */
  title: string;
  /** "Toyota Hiace · EVD72G · Isaac Smith", or "· No driver" */
  sub: string;
  /** the most pressing renewal or service, "Rego overdue", "Rego in 24 days"; null when nothing needs a look */
  word: Word | null;
};

export type PhoneFleet = { look: PhoneFleetRow[]; rest: PhoneFleetRow[] };

export type PhoneFleetVehicle = { vehicle: (PhoneVehicleBody & { driver: string | null }) | null };

const makeModel = (v: Vehicle) => [v.make.trim(), v.model.trim()].filter(Boolean).join(" ");
const daysWord = (n: number) => (n === 1 ? "1 day" : `${fmtKm(n)} days`);

/** What needs a look on one vehicle, worst first: a lapse before a renewal
    coming up, the nearest of those first. Null when nothing does. */
export function lookWord(v: Vehicle, warnDays: number): { word: Word; rank: number } | null {
  const found: { word: Word; rank: number }[] = [];
  for (const [kind, d] of [
    ["rego", v.regoDays],
    ["insurance", v.insuranceDays],
    ["ctp", v.ctpDays],
  ] as const) {
    if (d == null || d > warnDays) continue;
    const label = RENEWAL_ROW[kind];
    found.push(
      d < 0
        ? { word: { word: `${label} overdue`, tone: "wrong" }, rank: d }
        : { word: { word: d === 0 ? `${label} due today` : `${label} in ${daysWord(d)}`, tone: "look" }, rank: 100_000 + d },
    );
  }
  /* the service is due on whichever limit comes first, as the register's chip reads it */
  const svc = serviceDue(v, warnDays);
  if (svc.state !== "ok") {
    const km = svc.kmLeft;
    const kmState = km == null ? "ok" : km < 0 ? "bad" : km <= SERVICE_WARN_KM ? "warn" : "ok";
    const byKm = kmState === svc.state;
    const d = svc.daysLeft;
    found.push(
      svc.state === "bad"
        ? { word: { word: "Service overdue", tone: "wrong" }, rank: byKm || d == null ? -1 : d }
        : {
            word: { word: byKm && km != null ? `Service in ${fmtKm(km)} km` : d === 0 ? "Service due today" : `Service in ${daysWord(d ?? 0)}`, tone: "look" },
            rank: 100_000 + (d ?? warnDays),
          },
    );
  }
  return found.sort((a, b) => a.rank - b.rank)[0] ?? null;
}

const byTitle = (a: PhoneFleetRow, b: PhoneFleetRow) => a.title.localeCompare(b.title, "en-AU") || a.sub.localeCompare(b.sub, "en-AU");

export async function readPhoneFleet(ctx: MobileCtx): Promise<PhoneFleet> {
  const [{ vehicles }, staff, { warnDays }] = await Promise.all([listVehicles(ctx.orgId), listFleetStaff(ctx.orgId), orgExpiryWindow(ctx.orgId)]);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const look: (PhoneFleetRow & { rank: number })[] = [];
  const rest: PhoneFleetRow[] = [];
  for (const v of vehicles) {
    if (v.status === "sold") continue;
    const driver = v.assignedTo ? (nameOf.get(v.assignedTo) ?? null) : null;
    const row: PhoneFleetRow = {
      id: v.id,
      title: v.name.trim() || makeModel(v) || v.plate.trim() || "Vehicle",
      sub: [makeModel(v), v.plate.trim(), driver ?? "No driver"].filter(Boolean).join(" · "),
      word: null,
    };
    const w = lookWord(v, warnDays);
    if (w) look.push({ ...row, word: w.word, rank: w.rank });
    else rest.push(row);
  }
  return {
    look: look.sort((a, b) => a.rank - b.rank || byTitle(a, b)).map(({ rank: _rank, ...r }) => r),
    rest: rest.sort(byTitle),
  };
}

/** One vehicle of the working fleet, or null for one that isn't (sold, another org's, no such id). */
export async function readPhoneFleetVehicle(ctx: MobileCtx, id: string): Promise<PhoneFleetVehicle> {
  const want = id.trim();
  if (!want) return { vehicle: null };
  const [{ vehicles }, { warnDays }] = await Promise.all([listVehicles(ctx.orgId), orgExpiryWindow(ctx.orgId)]);
  const v = vehicles.find((x) => x.id === want && x.status !== "sold");
  if (!v) return { vehicle: null };
  const [logs, staff] = await Promise.all([listLogs(ctx.orgId, { vehicleId: v.id }), listFleetStaff(ctx.orgId)]);
  const driver = v.assignedTo ? (staff.find((s) => s.id === v.assignedTo)?.name ?? null) : null;
  /* for looking: no entry is anyone's to correct from here */
  const body = phoneVehicleOf(v, logs, { today: todayInAu(), warnDays, driver, me: null });
  /* the driver has a group of their own, so the grey line keeps the year and the nickname */
  return { vehicle: { ...body, head: [v.year ? String(v.year) : null, nickname(v)].filter(Boolean).join(", "), driver } };
}
