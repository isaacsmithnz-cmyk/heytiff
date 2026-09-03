/* The vehicle modal's derivations — pure, and the only place the five screens
   agree on what a fact MEANS.

   Everything a screen prints that is not a straight field read is computed
   here: which renewal is in force, what its status reads as, which documents
   sit under it, what the compliance list says, what the specs grid shows. The
   screens are layout; this is the reasoning, and it is tested without a DOM.

   Nothing here invents a value. A renewal nobody has filed is "Not set", a
   spec nobody has entered is not a row, and the estimated value is whatever
   Tiff last said or nothing — the design's seeded figures were sample data,
   and this codebase's rule is that a guessed figure is worse than a blank. */

import type { StoredDocument } from "@/lib/documents/query";
import { agoLabel, inLabel } from "@/lib/format/duration";
import {
  CTP_WARN_DAYS,
  INSURANCE_WARN_DAYS,
  REGO_WARN_DAYS,
  expiryState,
  fmtKm,
  fmtCost,
  type BodyType,
  type ChipState,
  type LogKind,
  type RenewalKind,
  type Vehicle,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleStatus,
} from "../logic";

/** The screens of the one modal. Main, and one per renewal kind. */
export type Screen = "main" | RenewalKind;

export const RENEWAL_TITLE: Record<RenewalKind, string> = {
  rego: "Registration",
  insurance: "Insurance",
  ctp: "Green slip (CTP)",
};

/** The compliance list's row label, uppercase by design. */
export const RENEWAL_ROW: Record<RenewalKind, string> = {
  rego: "REGO",
  insurance: "INSURANCE",
  ctp: "GREEN SLIP",
};

/** What the paper is called when filed. */
export const RENEWAL_PAPER: Record<RenewalKind, string> = {
  rego: "Rego notice",
  insurance: "Certificate of insurance",
  ctp: "Green slip",
};

const DAYS: Record<RenewalKind, (v: Vehicle) => number | null> = {
  rego: (v) => v.regoDays,
  insurance: (v) => v.insuranceDays,
  ctp: (v) => v.ctpDays,
};

const WARN: Record<RenewalKind, number> = {
  rego: REGO_WARN_DAYS,
  insurance: INSURANCE_WARN_DAYS,
  ctp: CTP_WARN_DAYS,
};

/** Days until this kind's cached expiry; null when nothing is recorded. */
export const renewalDays = (v: Vehicle, kind: RenewalKind): number | null => DAYS[kind](v);

/** The vehicle's state for this kind — the SAME rule the chips and the dashboard
    use, so the screen can never warn about something the chip is quiet on. */
export const renewalState = (v: Vehicle, kind: RenewalKind): ChipState =>
  expiryState(DAYS[kind](v), WARN[kind]);

/** "Renews in 3 weeks" · "Renews tomorrow" · "Expires today" · "Expired 4 days ago" · "Not set". */
export function renewalStatusText(days: number | null): string {
  if (days == null) return "Not set";
  if (days < 0) return `Expired ${agoLabel(days)}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Renews tomorrow";
  return `Renews ${inLabel(days)}`;
}

/** The renewal in force for a kind: the LATEST EXPIRY, not the newest upload —
    the same rule as the vehicle's cache column and currentRenewalDocIds. */
export function currentPolicy(policies: readonly VehiclePolicy[], kind: RenewalKind): VehiclePolicy | null {
  return policies
    .filter((p) => p.kind === kind)
    .reduce<VehiclePolicy | null>((best, p) => (!best || p.expiresOn > best.expiresOn ? p : best), null);
}

/** Every policy of a kind that is NOT the one in force, newest first. */
export function previousPolicies(policies: readonly VehiclePolicy[], kind: RenewalKind): VehiclePolicy[] {
  const current = currentPolicy(policies, kind);
  return policies
    .filter((p) => p.kind === kind && p.id !== current?.id)
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn));
}

/** The paperwork filed under one policy: whatever was filed against it, and
    the document it was read from — which predates the filing column and may
    only be linked from the policy's side. */
export function policyDocuments(documents: readonly StoredDocument[], policy: VehiclePolicy): StoredDocument[] {
  return documents.filter((d) => d.policyId === policy.id || (policy.documentId != null && d.id === policy.documentId));
}

/* ---- the main screen ---- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day on a card: "29 Sep 2027". Spelled here rather than by the locale
    tables, because ICU's en-AU says "Sept" and the browser's may not — a
    date that renders differently in a test and on a screen is a date nobody
    can pin a test to. */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}

export type ComplianceRow = {
  kind: RenewalKind;
  label: string;
  /** What the row says: the provider and date where a policy is filed,
      otherwise the countdown, otherwise "Not set". */
  value: string;
  state: ChipState;
  /** Nothing recorded at all — the row offers Add rather than a chevron. */
  unset: boolean;
};

export function complianceRows(v: Vehicle, policies: readonly VehiclePolicy[]): ComplianceRow[] {
  return (["rego", "insurance", "ctp"] as const).map((kind) => {
    const days = DAYS[kind](v);
    const policy = currentPolicy(policies, kind);
    const unset = days == null && !policy;
    const value = unset
      ? "Not set"
      : policy?.provider && days != null && days >= 0 && days > WARN[kind]
        ? `${policy.provider} · ${fmtDay(policy.expiresOn)}`
        : renewalStatusText(days);
    return { kind, label: RENEWAL_ROW[kind], value, state: renewalState(v, kind), unset };
  });
}

/** The amber bar across the top of the card — rego only, and only inside the
    warning window, because rego is the one whose lapse makes the vehicle
    illegal to drive tomorrow morning. */
export function regoAlert(v: Vehicle): string | null {
  const d = v.regoDays;
  if (d == null || d > REGO_WARN_DAYS) return null;
  if (d < 0) return "Rego has expired";
  if (d === 0) return "Rego expires today";
  return `Rego expires ${inLabel(d)}`;
}

export type SpecRow = { label: string; value: string; wide?: boolean };

/** The VEHICLE DETAILS grid: only what has been recorded. A spec nobody has
    entered is not a row reading "—"; it is absent, and an empty grid says so. */
export function specRows(v: Vehicle): SpecRow[] {
  const rows: SpecRow[] = [];
  if (v.vin) rows.push({ label: "VIN", value: v.vin, wide: true });
  if (v.engineNumber) rows.push({ label: "ENGINE NO.", value: v.engineNumber });
  if (v.engineCapacityCc) rows.push({ label: "ENGINE CAPACITY", value: `${fmtKm(v.engineCapacityCc)} cc` });
  if (v.seating) rows.push({ label: "SEATING", value: String(v.seating) });
  if (v.atmKg) rows.push({ label: "ATM", value: `${fmtKm(v.atmKg)} kg` });
  if (v.tareKg) rows.push({ label: "TARE", value: `${fmtKm(v.tareKg)} kg` });
  if (v.gvmKg) rows.push({ label: "GVM", value: `${fmtKm(v.gvmKg)} kg` });
  if (v.variant) rows.push({ label: "VARIANT", value: v.variant });
  if (v.colour) rows.push({ label: "COLOUR", value: v.colour });
  if (v.regoCustomerNo) rows.push({ label: "CUSTOMER NO.", value: v.regoCustomerNo });
  return rows;
}

/* The status pill's dot. Tokens, not the design's hexes: In service is the
   app's ok teal, Off road its bad red, For sale its info blue, Sold quiet. */
export const STATUS_DOT: Record<VehicleStatus, string> = {
  active: "var(--ok-t)",
  offroad: "var(--bad-t)",
  for_sale: "var(--info-t)",
  sold: "var(--q)",
};

/** The picture on the card: the vehicle's own photo when one is set and its
    link could be signed, else the line drawing for its body type. A motorised
    vehicle of unknown shape is drawn as a van, the fleet's common case. */
export function photoSrc(v: Vehicle, documents: readonly StoredDocument[]): { src: string; own: boolean } {
  const photo = v.photoDocumentId ? documents.find((d) => d.id === v.photoDocumentId) : undefined;
  if (photo?.url) return { src: photo.url, own: true };
  const type: BodyType = v.bodyType ?? (v.motorised ? "van" : "trailer");
  return { src: `/fleet/${type}.svg`, own: false };
}

/* ---- history ---- */

export type HistoryTab = "all" | "fuel" | "service" | "issue";

export const HISTORY_TABS: { key: HistoryTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fuel", label: "Fuel" },
  { key: "service", label: "Service" },
  { key: "issue", label: "Issues" },
];

/** The tabs a vehicle can use — no Fuel tab on something with no tank. */
export function historyTabs(v: Vehicle): { key: HistoryTab; label: string }[] {
  return HISTORY_TABS.filter((t) => v.motorised || t.key !== "fuel");
}

export function historyEvents(logs: readonly VehicleLog[], tab: HistoryTab, limit = 6): VehicleLog[] {
  const rows = tab === "all" ? logs : logs.filter((l) => l.kind === tab);
  return [...rows].sort((a, b) => a.ago - b.ago).slice(0, limit);
}

/** One line per event, the way a person would say it. */
export function historyLine(log: VehicleLog): string {
  switch (log.kind) {
    case "fuel":
      return `Fuel logged${log.litres ? ` — ${log.litres} L` : ""}${log.cost ? `, ${fmtCost(log.cost)}` : ""}`;
    case "odo":
      return `Odometer updated${typeof log.odo === "number" ? ` — ${fmtKm(log.odo)} km` : ""}`;
    case "service":
      return `Service — ${log.note ?? "completed"}`;
    case "issue":
      return `Issue ${log.status === "resolved" ? "resolved" : "reported"} — ${log.note ?? "no detail"}`;
  }
}

/** The log kinds the + menu offers this vehicle. */
export function logKinds(v: Vehicle): LogKind[] {
  return v.motorised ? ["fuel", "odo", "issue", "service"] : ["issue", "service"];
}
