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
import { dateFromDays } from "@/lib/fleet/map";
import {
  CTP_WARN_DAYS,
  FINANCE_KIND_LABEL,
  INSURANCE_WARN_DAYS,
  PAYMENTS_PER_YEAR,
  REGO_WARN_DAYS,
  expiryState,
  fmtKm,
  fmtCost,
  fmtMoney,
  type AiValuation,
  type BodyType,
  type ChipState,
  type LogKind,
  type RenewalKind,
  type Vehicle,
  type VehicleFinance,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleStatus,
} from "../logic";

/** The screens of the one modal. Main, one per renewal kind, and the money. */
export type Screen = "main" | RenewalKind | "financials";

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

/* ---- financials ---- */

/** The agreement in force: the newest schedule by start date, like a policy's
    latest expiry — never the newest upload. */
export function currentFinance(list: readonly VehicleFinance[]): VehicleFinance | null {
  return list.reduce<VehicleFinance | null>((best, f) => (!best || f.startsOn > best.startsOn ? f : best), null);
}

/** Every agreement that is not the one in force, newest first. */
export function previousFinance(list: readonly VehicleFinance[]): VehicleFinance[] {
  const current = currentFinance(list);
  return list.filter((f) => f.id !== current?.id).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}

/** The paper filed under one agreement, plus the document it was read from. */
export function financeDocuments(documents: readonly StoredDocument[], f: VehicleFinance): StoredDocument[] {
  return documents.filter((d) => d.financeId === f.id || (f.documentId != null && d.id === f.documentId));
}

/** An ISO day plus whole months, clamped to the month's last day — 31 Jan
    plus one month is 28 Feb, not 3 Mar. Dates only; no clock, no zone. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** When the schedule runs out: start plus term. Derived, and labelled so. */
export const financeEndsOn = (f: VehicleFinance): string => addMonths(f.startsOn, f.termMonths);

/** Whole months from one ISO day to another, floor; negative when `to` is earlier. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export type FinancePosition = {
  /** Repayments on the whole schedule. */
  total: number;
  /** Repayments that have FALLEN DUE by today — not payments seen; nothing here tracks them. */
  made: number;
  remaining: number;
  /** 0..1, for the bar. */
  progress: number;
  /** remaining × repayment + balloon, or null when the agreement didn't state a repayment. */
  payout: number | null;
  started: boolean;
  ended: boolean;
};

/** Where the schedule says the agreement stands today. Arithmetic on the
    agreement's own terms and nothing more: the screen says "assumes every
    payment made as scheduled" and sends the person to the lender for the
    real payout figure. */
export function financePosition(f: VehicleFinance, today: string): FinancePosition {
  const perYear = PAYMENTS_PER_YEAR[f.frequency];
  const total = Math.max(1, Math.round((f.termMonths * perYear) / 12));
  const elapsed =
    f.frequency === "monthly"
      ? monthsBetween(f.startsOn, today)
      : Math.floor(daysBetween(f.startsOn, today) / (f.frequency === "fortnightly" ? 14 : 7));
  const made = Math.min(total, Math.max(0, elapsed));
  const remaining = total - made;
  const payout = f.repayment == null ? null : Math.round(remaining * f.repayment + (f.balloon ?? 0));
  return {
    total,
    made,
    remaining,
    progress: made / total,
    payout,
    started: f.startsOn <= today,
    ended: financeEndsOn(f) <= today,
  };
}

const PER: Record<VehicleFinance["frequency"], string> = { monthly: "month", fortnightly: "fortnight", weekly: "week" };

/** "$742 / month" — null when the agreement didn't state a repayment. */
export function repaymentLabel(f: VehicleFinance): string | null {
  return f.repayment == null ? null : `${fmtMoney(f.repayment)} / ${PER[f.frequency]}`;
}

/** A year of repayments at the stated frequency, or null. */
export function annualRepayments(f: VehicleFinance): number | null {
  return f.repayment == null ? null : f.repayment * PAYMENTS_PER_YEAR[f.frequency];
}

export type FactRow = { label: string; value: string; faint?: boolean };

const recorded = (s: string | null | undefined): Pick<FactRow, "value" | "faint"> =>
  s ? { value: s } : { value: "Not recorded", faint: true };
const moneyOr = (n: number | null | undefined): Pick<FactRow, "value" | "faint"> =>
  recorded(n != null && n > 0 ? fmtMoney(n) : null);

/** The FINANCE AGREEMENT grid: what the lender wrote, in the order the design reads it. */
export function financeRows(f: VehicleFinance): FactRow[] {
  return [
    { label: "LENDER", value: f.lender },
    { label: "AGREEMENT NO.", ...recorded(f.agreementNo) },
    { label: "TYPE", ...recorded(f.kind ? FINANCE_KIND_LABEL[f.kind] : null) },
    { label: "START", value: fmtDay(f.startsOn) },
    { label: "TERM", value: `${f.termMonths} months` },
    { label: "ENDS", value: fmtDay(financeEndsOn(f)) },
    { label: "REPAYMENT", ...recorded(repaymentLabel(f)) },
    { label: "RATE", ...recorded(f.ratePct != null ? `${f.ratePct}% p.a.` : null) },
    { label: "BALLOON", ...moneyOr(f.balloon) },
    { label: "AMOUNT FINANCED", ...moneyOr(f.amountFinanced) },
  ];
}

/** The PURCHASE grid, as the invoice prints it. The deposit row reads PAID
    when nothing was financed; the balance row only exists when something was. */
export function purchaseRows(v: Vehicle, today: string, finance: VehicleFinance | null): FactRow[] {
  const rows: FactRow[] = [
    { label: "SUPPLIER", ...recorded(v.purchaseSupplier) },
    { label: "INVOICE NO.", ...recorded(v.purchaseInvoiceNo) },
    { label: "DATE", ...recorded(v.purchaseDateDays ? fmtDay(dateFromDays(-v.purchaseDateDays, today)) : null) },
    { label: "PRICE EX GST", ...moneyOr(v.purchaseExGst) },
    { label: "GST", ...moneyOr(v.purchaseGst) },
    { label: "ON-ROAD COSTS", ...moneyOr(v.purchaseOnRoad) },
    { label: "TOTAL PRICE", ...moneyOr(v.purchasePrice) },
  ];
  if (finance) {
    rows.push({ label: "DEPOSIT PAID", ...moneyOr(v.purchaseDeposit) });
    rows.push({ label: "BALANCE FINANCED", ...moneyOr(finance.amountFinanced) });
  } else {
    rows.push({ label: "PAID", ...moneyOr(v.purchaseDeposit ?? v.purchasePrice) });
  }
  rows.push({
    label: "ODOMETER AT PURCHASE",
    ...recorded(v.purchaseOdometer != null ? `${fmtKm(v.purchaseOdometer)} km` : null),
  });
  rows.push({ label: "FUNDING", value: finance ? "Deposit + finance" : "No finance recorded", faint: !finance });
  return rows;
}

/** What the VALUE card says under Tiff's figure — the estimate's own note,
    where it was read, and whether the odometer has since moved past it. */
export function valueNotes(val: AiValuation | undefined, v: Vehicle, stale: boolean): string[] {
  if (!val) return [];
  const notes: string[] = [];
  if (val.note) notes.push(val.note);
  notes.push(`Valued at ${fmtKm(val.atOdo)} km`);
  if (stale) notes.push(`Odometer has moved ${fmtKm(v.odometer - val.atOdo)} km since — value again for a current figure`);
  return notes;
}

/* ---- cost to run ----
   Actuals, not a forecast. Fuel and servicing are what was LOGGED in the last
   twelve months; rego, green slip and insurance are the premium on the policy
   in force, annualised over its own term; finance is a year of repayments at
   the stated frequency. A category nothing has been logged in is null — shown
   as a dash, never as $0 — and the total is the sum of what is known. */

export const COST_WINDOW_DAYS = 365;

export type CostItem = { key: string; label: string; value: number | null };
export type CostToRun = {
  items: CostItem[];
  total: number;
  /** How many of the items carry a figure — 0 means there is nothing to total. */
  known: number;
  sinceIso: string;
  /** Kilometres between the first and last odometer reading logged in the window. */
  kmDriven: number | null;
  /** Dollars per kilometre over the window, when the readings support one. */
  perKm: number | null;
};

export function costToRun(
  v: Vehicle,
  logs: readonly VehicleLog[],
  policies: readonly VehiclePolicy[],
  finance: readonly VehicleFinance[],
  today: string,
): CostToRun {
  const window = logs.filter((l) => l.ago >= 0 && l.ago <= COST_WINDOW_DAYS);
  const logged = (kind: LogKind): number | null => {
    const xs = window.filter((l) => l.kind === kind && typeof l.cost === "number");
    return xs.length === 0 ? null : xs.reduce((a, l) => a + (l.cost ?? 0), 0);
  };
  const annualPremium = (kind: RenewalKind): number | null => {
    const p = currentPolicy(policies, kind);
    if (!p || p.premium == null) return null;
    const term = p.termMonths && p.termMonths > 0 ? p.termMonths : 12;
    // to the cent: a premium annualised over its own term is still money
    return Math.round(((p.premium * 12) / term) * 100) / 100;
  };

  const fin = currentFinance(finance);
  const items: CostItem[] = [];
  if (fin && !financePosition(fin, today).ended) items.push({ key: "finance", label: "FINANCE", value: annualRepayments(fin) });
  items.push(
    { key: "insurance", label: "INSURANCE", value: annualPremium("insurance") },
    { key: "rego", label: "REGO", value: annualPremium("rego") },
    { key: "ctp", label: "GREEN SLIP", value: annualPremium("ctp") },
    { key: "service", label: "SERVICING", value: logged("service") },
  );
  if (v.motorised) items.push({ key: "fuel", label: "FUEL", value: logged("fuel") });

  const known = items.filter((i) => i.value != null).length;
  const total = items.reduce((a, i) => a + (i.value ?? 0), 0);
  const odos = window.map((l) => l.odo).filter((n): n is number => typeof n === "number" && n > 0);
  const kmDriven = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : null;
  const perKm = kmDriven != null && kmDriven >= 100 && total > 0 ? total / kmDriven : null;
  return { items, total, known, sinceIso: dateFromDays(-COST_WINDOW_DAYS, today), kmDriven, perKm };
}
