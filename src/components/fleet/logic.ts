/* Fleet — pure logic: vehicle status derivation, the odometer guardrail,
   valuation parsing, filtering, sorting & formatting. Mirrors timepay/logic.ts:
   everything here is side-effect free and jest-covered. Data comes from
   lib/fleet/query.ts and mutations go through app/actions/fleet.ts; this file
   knows about neither. */

import { agoLabel, expiryClause, inLabel } from "@/lib/format/duration";
import { daysUntil } from "@/lib/au-dates";

/* Four states, and the third is not a softer fourth. A vehicle FOR SALE is
   still in the fleet — it needs rego, it needs insurance, someone may drive it
   to the buyer — so every warning still applies. SOLD is the exit: gone from
   the working fleet, kept in the register for its paper trail. */
export type VehicleStatus = "active" | "offroad" | "for_sale" | "sold";

/** What shape of thing a vehicle is. Drives the placeholder illustration and
    the CTP vehicle class. `motorised` stays the truth about whether it has an
    engine — a trailer is the common case, not the only one. */
export const BODY_TYPES = ["van", "ute", "car", "truck", "trailer"] as const;
export type BodyType = (typeof BODY_TYPES)[number];
export const BODY_TYPE_LABEL: Record<BodyType, string> = {
  van: "Van",
  ute: "Ute",
  car: "Car",
  truck: "Truck",
  trailer: "Trailer",
};

/* What the registration certificate says the vehicle IS. Optional AND
   nullable: none of it existed before the certificate could be scanned in,
   and an unrecorded spec is "not recorded", never a value — the rule the
   expiry dates learned the hard way. Register width only: the picker names a
   vehicle by its plate, and the driver's own screen has not asked for these. */
export type VehicleSpecs = {
  bodyType?: BodyType | null;
  colour?: string | null;
  vin?: string | null;
  engineNumber?: string | null;
  engineCapacityCc?: number | null;
  seating?: number | null;
  tareKg?: number | null;
  gvmKg?: number | null;
  /** Trailers: aggregate trailer mass, the figure on their compliance plate. */
  atmKg?: number | null;
  variant?: string | null;
  /** The road authority's customer number for this registration. */
  regoCustomerNo?: string | null;
  /** The document row behind the photo on the card, once one has been set. */
  photoDocumentId?: string | null;
};

/* The vehicle type comes in three widths, and they are the projection boundary
   (lib/projections.ts) written as types — a function that only needs identity
   takes VehicleIdentity, so it cannot accidentally be passed data a staff
   member was never sent.

   Day-counts (regoDays, insuranceDays) are a VIEW of real `date` columns,
   derived once at the query boundary against an AU calendar date. Nothing
   below this line knows a date exists. They are nullable because the columns
   are: an absent date is not a number, and no number can stand in for one. */

/** What anyone may see about a vehicle they're allowed to act on — the pool
    picker's payload, and nothing more (VEHICLE_PICKER_FIELDS). */
export type VehicleIdentity = {
  id: string;
  /** Optional friendly name / fleet no. (e.g. "VRF-04"); rego is the fallback identity. */
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string; // rego plate — the primary identifier
  /** AU plates are only unique within a state/territory; null = unstated. */
  plateState: string | null;
  status: VehicleStatus;
  odometer: number; // km — drives the can't-go-backwards guardrail
};

/** Your own vehicle: identity plus the compliance facts My vehicle exists to
    show. Still no money and no assignment — those are register knowledge. */
export type VehicleWithFacts = VehicleIdentity & {
  /* NULL IS UNKNOWN, and it is not the same thing as "far off".

     These carried 365 for both, which made an unstated expiry indistinguishable
     from one a year out. Two things went wrong with that. A vehicle whose
     paperwork nobody had entered rendered "renews in 12 months" — a fact no
     document supports — and opening the edit form on it pre-filled that
     invented date, so SAVING wrote it to the column. The stand-in became data.

     Null says nothing, warns about nothing, and round-trips as null. */
  regoDays: number | null; // days until rego expires (negative = expired)
  insuranceDays: number | null; // days until insurance expires
  /* CTP — the green slip in NSW. A THIRD date rather than a flavour of
     insurance: it is the cover the state makes you carry to be registered, it
     comes from an insurer who need not be the comprehensive one, and it runs
     to its own expiry on its own certificate. Folding it into insuranceDays
     would let a green slip retire the comprehensive warning, which is the one
     that costs real money when it lapses unnoticed. */
  ctpDays: number | null; // days until CTP / green slip expires
  /* The service cycle has TWO limits and falls due on whichever arrives first.
     Either may be null, which means that limit does not apply to this vehicle
     — a trailer has no distance limit, a vehicle nobody has given a time
     interval has no time limit. */
  serviceIntervalKm: number | null; // service every N km
  lastServiceOdo: number; // odometer at the last completed service
  serviceIntervalMonths: number | null; // ...or every N months
  /** Days until the time limit falls due. Null = no time limit, or nothing has
      anchored one yet. Computed in lib/fleet/map.ts against the SERVER's date,
      like regoDays — a clock read in a render body breaks hydration. */
  serviceDays: number | null;
  /** False for anything with no motor: no odometer, so no distance limit. */
  motorised: boolean;
};

/** The full register record — `assets_all` only. */
export type Vehicle = VehicleWithFacts & VehicleSpecs & {
  assignedTo: string | null; // staff_profiles.id; null = pool / unassigned
  value: number; // $ book value
  purchasePrice: number; // $ — 0 = unknown; feeds the Tiff estimate
  purchaseDateDays: number; // days since purchase (0 = unknown/new)
  /** Days SINCE the last service — the anchor the time limit counts from, as
      the form edits it. `serviceDays` is the countdown derived from it; this is
      the stored date. Null = nothing has anchored the cycle yet. */
  lastServiceDays: number | null;
  notes?: string;
};

/** The roster as Fleet knows it. Assigning a vehicle needs a name and whether
    they still work here — not an HR record. Sourced by lib/fleet/query.ts. */
export type FleetStaff = { id: string; name: string; status: "Active" | "Inactive" };

export type LogKind = "fuel" | "odo" | "issue" | "service";

/** What the log modal submits. Who logged it, when, and which org are the
    server's to decide — a client that could name the author could name
    someone else. */
/* WHOSE MONEY BOUGHT THE FUEL. It decides what the log produces beyond itself:
   a company card is the business's own spend and stops at the vehicle log (and
   the tax line it feeds), while a personal card leaves someone out of pocket
   and must also raise an expense claim so they get paid back. */
export const FUEL_PAYERS = ["company", "own"] as const;
export type FuelPayer = (typeof FUEL_PAYERS)[number];

export const FUEL_PAYER_LABEL: Record<FuelPayer, string> = {
  company: "Company card",
  own: "My own money",
};

export function isFuelPayer(v: unknown): v is FuelPayer {
  return typeof v === "string" && (FUEL_PAYERS as readonly string[]).includes(v);
}

export type NewLog = {
  vehicleId: string;
  kind: LogKind;
  note?: string;
  litres?: number;
  cost?: number;
  odo?: number;
  source?: "scan" | "manual";
  station?: string;
  /* ---- the tax half of a fuel log ---- */
  /** GST as printed on the docket. Absent means the docket didn't show one —
      never a calculated eleventh. */
  gst?: number;
  /** Supplier ABN, eleven digits, no spaces. */
  abn?: string;
  /** The date on the docket. Absent = bought today, which is the common case;
      the server decides either way and refuses anything implausible. */
  purchasedOn?: string;
  /** The stored receipt photo, already uploaded, waiting to be adopted. */
  receiptDocumentId?: string;
  /** Fuel only. Defaults to `company` — the common case, and the one that
      raises nothing extra. `own` also raises a reimbursement claim. */
  paidWith?: FuelPayer;
};

export type VehicleLog = {
  id: string;
  vehicleId: string;
  staffId: string | null; // who logged it (null = imported / system)
  staffName?: string;
  kind: LogKind;
  when: string; // display date, e.g. "Wed 15 Jul"
  ago: number; // days ago — drives newest-first ordering
  note?: string;
  litres?: number;
  cost?: number;
  odo?: number;
  status?: "open" | "resolved"; // issues only
  source?: "scan" | "manual"; // fuel logs: receipt-scanned vs typed
  station?: string; // fuel logs: where the fill happened
  gst?: number; // fuel logs: GST as printed on the docket
  abn?: string; // fuel logs: supplier ABN, eleven digits
  /** True when the docket photo is stored against this log — the difference
      between a figure somebody typed and one you can produce at audit. */
  hasReceipt?: boolean;
  /** True once somebody has corrected this entry. Said on the row rather than
      hidden: a figure that has been changed is a different kind of fact from
      one nobody has touched. */
  edited?: boolean;
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  active: "In service",
  offroad: "Off road",
  for_sale: "For sale",
  sold: "Sold",
};

/** Row/hero identity: friendly name when set, else the rego plate. */
export function displayName(v: VehicleIdentity): string {
  return v.name || v.plate;
}

/** "Toyota Hiace ZR 2022" (year omitted when unknown). */
export function modelLabel(v: VehicleIdentity): string {
  return [v.make, v.model, v.year || null].filter(Boolean).join(" ");
}

/* ---- service schedule: distance OR time, whichever arrives first ---- */

/** The odometer this vehicle is next due at, or null with no distance limit. */
export function serviceDueKm(v: VehicleWithFacts): number | null {
  if (!v.motorised || v.serviceIntervalKm == null) return null;
  return v.lastServiceOdo + v.serviceIntervalKm;
}

export function serviceKmLeft(v: VehicleWithFacts): number | null {
  const due = serviceDueKm(v);
  return due == null ? null : due - v.odometer;
}

/* ---- status chips ---- */

export type ChipState = "ok" | "warn" | "bad";
export type StatusChip = { label: string; state: ChipState };

/** The state an expiry day-count puts a vehicle in. Null — nobody has entered
    the date — is silent rather than "ok": it warns about nothing, because the
    paperwork may well be in order and this is not evidence either way. The
    fact row says so in words instead of counting down to a made-up date. */
export function expiryState(days: number | null, warnAt: number): ChipState {
  if (days == null) return "ok";
  return days < 0 ? "bad" : days <= warnAt ? "warn" : "ok";
}

/** What a fact row says where no date has been entered. */
const NOT_SET = "Not set";

export const REGO_WARN_DAYS = 30;
export const INSURANCE_WARN_DAYS = 30;
export const CTP_WARN_DAYS = 30;
export const SERVICE_WARN_KM = 1500;
export const SERVICE_WARN_DAYS = 30;

/* WHICHEVER ARRIVES FIRST, without predicting anything.

   There is no need to rank a distance against a date — and no honest way to,
   since it would take a km-per-day rate nobody has. The service is due when
   the FIRST limit is reached, so each limit is judged on its own and the worse
   verdict is the vehicle's. A limit that does not apply says nothing rather
   than saying "fine": a trailer is not "0 km from due", it simply has no
   distance to be measured in. */
export type ServiceDue = {
  /** Null when this limit does not apply. Negative = past it. */
  kmLeft: number | null;
  daysLeft: number | null;
  state: ChipState;
};

function limitState(left: number | null, warnAt: number): ChipState {
  if (left == null) return "ok";
  return left < 0 ? "bad" : left <= warnAt ? "warn" : "ok";
}

export function serviceDue(v: VehicleWithFacts): ServiceDue {
  const kmLeft = serviceKmLeft(v);
  const daysLeft = v.serviceDays;
  const km = limitState(kmLeft, SERVICE_WARN_KM);
  const days = limitState(daysLeft, SERVICE_WARN_DAYS);
  const rank: ChipState[] = ["ok", "warn", "bad"];
  return {
    kmLeft,
    daysLeft,
    state: rank[Math.max(rank.indexOf(km), rank.indexOf(days))],
  };
}

/* Days until the time limit falls due, from the anchor and the interval.

   One function, used by the mapper that feeds the screens AND by the form that
   sets the fields — so what the form says it is doing and what the countdown
   then reports cannot drift. Month arithmetic, not 30-day blocks: "12 months
   from 29 Feb" has an answer the calendar gives and multiplication doesn't. */
export function serviceDaysUntil(
  lastServiceOn: string | null,
  months: number | null,
  today: string,
): number | null {
  if (!lastServiceOn || !months) return null;
  const due = new Date(`${lastServiceOn}T00:00:00Z`);
  due.setUTCMonth(due.getUTCMonth() + months);
  return daysUntil(due.toISOString().slice(0, 10), today);
}

/** How the nearer limit reads. Null when neither limit applies — a vehicle
    with no cycle at all, which must not be dressed up as one that is fine. */
export function serviceDueText(v: VehicleWithFacts): string | null {
  const { kmLeft, daysLeft } = serviceDue(v);
  const parts: string[] = [];
  if (kmLeft != null) parts.push(kmLeft < 0 ? `${fmtKm(-kmLeft)} km overdue` : `in ${fmtKm(kmLeft)} km`);
  if (daysLeft != null)
    parts.push(daysLeft < 0 ? `${agoLabel(daysLeft)} overdue` : `in ${inLabel(daysLeft).replace(/^in /, "")}`);
  return parts.length === 0 ? null : parts.join(" or ");
}

/** Everything wrong (or soon-wrong) with a vehicle, worst-first. Empty = all good. */
export function vehicleChips(v: VehicleWithFacts, openIssues: number): StatusChip[] {
  if (v.status === "sold") return [];
  const chips: StatusChip[] = [];
  if (v.status === "offroad") chips.push({ label: "Off road", state: "bad" });
  // one label for both tenses now that expiryClause carries the tense itself
  /* A date nobody has entered raises no chip. It is tempting to warn on the
     blank — but the register is filled in over time, and a fleet that shouts
     about every unentered field teaches people to ignore the shouting. */
  if (v.regoDays != null && v.regoDays <= REGO_WARN_DAYS)
    chips.push({ label: `Rego ${expiryClause(v.regoDays)}`, state: v.regoDays < 0 ? "bad" : "warn" });
  if (v.insuranceDays != null) {
    if (v.insuranceDays < 0) chips.push({ label: "Insurance expired", state: "bad" });
    else if (v.insuranceDays <= INSURANCE_WARN_DAYS)
      chips.push({ label: `Insurance ${expiryClause(v.insuranceDays)}`, state: "warn" });
  }
  /* Its own chip beside rego's, not folded into it. They usually fall on the
     same day and the rego chip would be right most of the time — but an
     unrenewed green slip is what stops the rego renewing at all, and "most of
     the time" is not a warning. */
  if (v.ctpDays != null) {
    if (v.ctpDays < 0) chips.push({ label: "Green slip expired", state: "bad" });
    else if (v.ctpDays <= CTP_WARN_DAYS)
      chips.push({ label: `Green slip ${expiryClause(v.ctpDays)}`, state: "warn" });
  }
  /* One chip for the cycle, reading whichever limit is worse — the vehicle is
     due on the first of them, so two chips would be two ways of saying it. */
  const svc = serviceDue(v);
  if (svc.state !== "ok") {
    const byKm = limitState(svc.kmLeft, SERVICE_WARN_KM) === svc.state;
    const km = svc.kmLeft ?? 0;
    const days = svc.daysLeft ?? 0;
    chips.push({
      label: byKm
        ? km < 0
          ? `Service overdue ${fmtKm(-km)} km`
          : `Service in ${fmtKm(km)} km`
        : days < 0
          ? `Service overdue ${agoLabel(days)}`
          : `Service ${inLabel(days)}`,
      state: svc.state,
    });
  }
  if (openIssues > 0)
    chips.push({ label: openIssues === 1 ? "1 issue open" : `${openIssues} issues open`, state: "warn" });
  const order: ChipState[] = ["bad", "warn", "ok"];
  return chips.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
}

export function worstState(chips: StatusChip[]): ChipState {
  if (chips.some((c) => c.state === "bad")) return "bad";
  if (chips.some((c) => c.state === "warn")) return "warn";
  return "ok";
}

/* ---- shared fact derivation (detail modal + my-vehicle tiles) ---- */

export type VehicleFact = { key: string; label: string; text: string; state: ChipState };

export function vehicleFacts(v: VehicleWithFacts): VehicleFact[] {
  const svc = serviceDue(v);
  return [
    /* No motor, no odometer — and a trailer reading "0 km" would be a figure
       standing where a fact should be, which is how a seeded default gets
       mistaken for a reading. */
    ...(v.motorised
      ? [{ key: "odo", label: "Odometer", text: `${fmtKm(v.odometer)} km`, state: "ok" as ChipState }]
      : []),
    {
      key: "service",
      label: "Next service",
      text: serviceDueText(v) ?? "No cycle set",
      state: svc.state,
    },
    {
      key: "rego",
      label: "Rego",
      text:
        v.regoDays == null
          ? NOT_SET
          : v.regoDays < 0
            ? `expired ${agoLabel(v.regoDays)}`
            : `renews ${inLabel(v.regoDays)}`,
      state: expiryState(v.regoDays, REGO_WARN_DAYS),
    },
    {
      key: "insurance",
      label: "Insurance",
      text:
        v.insuranceDays == null
          ? NOT_SET
          : v.insuranceDays < 0
            ? "expired"
            : `renews ${inLabel(v.insuranceDays)}`,
      state: expiryState(v.insuranceDays, INSURANCE_WARN_DAYS),
    },
    {
      key: "ctp",
      label: "Green slip",
      text:
        v.ctpDays == null ? NOT_SET : v.ctpDays < 0 ? "expired" : `renews ${inLabel(v.ctpDays)}`,
      state: expiryState(v.ctpDays, CTP_WARN_DAYS),
    },
  ];
}

/* ---- Tiff valuations (real AI — src/app/actions/fleet-ai.ts) ----
   The server action asks Claude for AU-market valuations; the validated
   results are cached on vehicles.ai_value, stamped with the odometer they were
   computed at. Manager+ only — the column is in the `assets_all` projection
   and nowhere else. */

/* A renewal on file — one insurance policy or rego period. The newest
   expires_on is current; the rest are the history, and the vehicle's expiry
   column is a cache of the newest. `premium` is null when the document didn't
   print one: never derived, for the same reason fuel GST isn't. */
export type VehiclePolicy = {
  id: string;
  kind: RenewalKind;
  provider: string | null;
  premium: number | null;
  startsOn: string | null;
  expiresOn: string;
  /** The ONE document this row was read from; null if entered by hand. The
      rest of a policy's paperwork is filed against it via documents.policy_id. */
  documentId: string | null;
  /* What else the certificate said. Optional because rows that predate the
     scan have none of it; nullable because a document may not print it — a
     rego notice has no policy number, a green slip has no excess. */
  policyNumber?: string | null;
  cover?: InsuranceCover | null;
  excess?: number | null;
  termMonths?: number | null;
  garagingPostcode?: string | null;
  /** Rego: the safety check (pink slip) date, where one was required. */
  inspectionOn?: string | null;
  /** How the row got here. Scanned and typed are different levels of trust. */
  source?: PolicySource | null;
};

export const INSURANCE_COVERS = [
  "comprehensive",
  "third_party_property",
  "third_party_fire_theft",
] as const;
export type InsuranceCover = (typeof INSURANCE_COVERS)[number];
export const INSURANCE_COVER_LABEL: Record<InsuranceCover, string> = {
  comprehensive: "Comprehensive",
  third_party_property: "Third party property",
  third_party_fire_theft: "Third party, fire & theft",
};

export type PolicySource = "scan" | "manual";

/** The document kind each renewal kind arrives as. */
export const RENEWAL_DOC_KIND = {
  insurance: "insurance_policy",
  rego: "rego_notice",
  ctp: "green_slip",
} as const;

export type RenewalKind = keyof typeof RENEWAL_DOC_KIND;

/** Every renewal kind, once, in the order they read on a vehicle. Derived from
    the map above so a fourth kind can never be half-added: adding it there is
    what makes it appear in the facts, the history and the current-document
    rule. */
export const RENEWAL_KINDS = Object.keys(RENEWAL_DOC_KIND) as readonly RenewalKind[];

/** Which vehicle column caches a kind's newest expiry. The policy rows are the
    record; these are the cache every chip, filter and attention count reads. */
export const RENEWAL_EXPIRY_COLUMN: Record<RenewalKind, string> = {
  insurance: "insurance_expiry",
  rego: "rego_expiry",
  ctp: "ctp_expiry",
};

/* WHICH DOCUMENT IS ACTUALLY IN FORCE.

   The newest UPLOAD is not the answer. Renewals can be filed at any time now,
   including a back-catalogue policy entered long after it lapsed — so the
   latest expiry decides, exactly as it decides the vehicle's cached expiry
   column. Reading it off the upload date instead would tag a 2024 policy
   "Current" the moment it was typed in, while the vehicle's own expiry
   (correctly) stayed on the live one: two answers to one question, which is
   the thing deriving this was meant to prevent.

   The latest expiry is picked outright rather than trusting the caller's sort:
   the query does order by expires_on, but a rule about which paper is in force
   should not quietly depend on that staying true.

   With no policy row of that kind there is nothing stating a period, and the
   newest upload is the best available answer. */
export function currentRenewalDocIds(
  policies: readonly Pick<VehiclePolicy, "kind" | "expiresOn" | "documentId">[],
  documents: readonly { id: string; kind: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const kind of RENEWAL_KINDS) {
    const filed = policies.filter((p) => p.kind === kind);
    const inForce = filed
      .filter((p) => p.documentId)
      .reduce<(typeof filed)[number] | null>(
        (best, p) => (!best || p.expiresOn > best.expiresOn ? p : best),
        null,
      );
    if (inForce?.documentId) {
      out.add(inForce.documentId);
    } else if (filed.length === 0) {
      const newest = documents.find((d) => d.kind === RENEWAL_DOC_KIND[kind]);
      if (newest) out.add(newest.id);
    }
  }
  return out;
}

export type AiValuation = {
  point: number;
  low: number;
  high: number;
  note: string;
  atOdo: number; // odometer reading when Tiff valued it
};

export const VALUATION_STALE_KM = 2000;

/** A valuation goes stale once the vehicle has driven well past where it was valued. */
export function valuationStale(v: VehicleIdentity, val: AiValuation | undefined): boolean {
  return !!val && v.odometer - val.atOdo > VALUATION_STALE_KM;
}

/** Validate/clamp raw model output against the actual fleet. Unknown ids and
    junk entries are dropped; low/high are ordered, point clamped between them,
    everything rounded to $100 and stamped with the vehicle's current odo. */
export function parseValuations(raw: unknown, vehicles: VehicleIdentity[]): Record<string, AiValuation> {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const out: Record<string, AiValuation> = {};
  const list = (raw as { valuations?: unknown })?.valuations;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const v = byId.get(String(rec.id));
    if (!v) continue;
    let low = Number(rec.low);
    let high = Number(rec.high);
    let point = Number(rec.point);
    if (![low, high, point].every((n) => Number.isFinite(n) && n >= 0)) continue;
    if (low > high) [low, high] = [high, low];
    point = Math.min(high, Math.max(low, point));
    const r = (n: number) => Math.max(0, Math.round(n / 100) * 100);
    out[v.id] = {
      point: r(point),
      low: r(low),
      high: r(high),
      note: typeof rec.note === "string" ? rec.note.slice(0, 200) : "",
      atOdo: v.odometer,
    };
  }
  return out;
}

/* ---- odometer guardrail ----
   A reading can only ever go forward. The modal shows this as a hint before
   you save; the server action re-runs it, because the modal is not a control. */

export function odoRejection(current: number, reading: number | undefined): string | null {
  if (typeof reading !== "number" || !Number.isFinite(reading)) return null;
  if (reading < 0) return "An odometer reading can't be negative.";
  if (reading < current)
    return `That's below the last reading of ${fmtKm(current)} km — odometers only go forward.`;
  return null;
}

/** What a log does to its vehicle's odometer/service cycle. Returns the fields
    to patch, or null when the log leaves the vehicle alone (issues, no reading). */
export function odoEffect(
  v: Pick<Vehicle, "odometer" | "lastServiceOdo">,
  log: { kind: LogKind; odo?: number },
): { odometer: number; lastServiceOdo?: number } | null {
  if (typeof log.odo !== "number") return null;
  // a completed service resets the cycle from its own reading
  if (log.kind === "service")
    return { odometer: Math.max(v.odometer, log.odo), lastServiceOdo: log.odo };
  return log.odo > v.odometer ? { odometer: log.odo } : null;
}

/* What the vehicle's odometer should be once a log has been edited or removed.

   RECOMPUTED, never reversed. Undoing a delta ("this log added 680 km, take
   them back") needs the odometer to have been touched by nothing else since,
   which is not true the moment two people log a fill on the same day. The
   surviving readings are the whole truth, and the guardrail guarantees the
   answer: a reading below the current odometer is refused at save time, so the
   highest surviving reading is always where the vehicle actually is.

   WHEN NOTHING SURVIVES the value is left alone, because it cannot be
   recovered — a vehicle is added with an odometer already on it, and that
   number exists nowhere else. Left alone it reads high, which is the safe
   direction: the guardrail only ever refuses readings that are too LOW.

   The service cycle is left alone for the same reason and a sharper one: it is
   a field on the vehicle that a manager sets directly, and logs only push it
   forward. Wiping it because the last service log was deleted would throw away
   something nobody asked to delete. */
export function odoRecompute(
  logs: readonly { kind: LogKind; odo?: number }[],
  current: { odometer: number; lastServiceOdo: number },
): { odometer: number; lastServiceOdo: number } {
  const readings = logs.map((l) => l.odo).filter((o): o is number => typeof o === "number");
  const services = logs
    .filter((l) => l.kind === "service")
    .map((l) => l.odo)
    .filter((o): o is number => typeof o === "number");
  return {
    odometer: readings.length > 0 ? Math.max(...readings) : current.odometer,
    lastServiceOdo: services.length > 0 ? Math.max(...services) : current.lastServiceOdo,
  };
}

export function logsFor(logs: VehicleLog[], vehicleId: string): VehicleLog[] {
  return logs.filter((l) => l.vehicleId === vehicleId);
}

export function openIssueCount(logs: VehicleLog[], vehicleId: string): number {
  return logs.filter((l) => l.vehicleId === vehicleId && l.kind === "issue" && l.status === "open").length;
}

/* ---- offline receipt fallback (deterministic — no Tiff needed) ----
   When the readFuelReceipt action can't run (no API key, offline dev), derive
   a plausible AU fill from the image's file size so the scan flow still demos:
   same file, same reading. */

export const RECEIPT_STATIONS = [
  "Shell Coburg",
  "BP Ringwood",
  "Ampol Dandenong",
  "7-Eleven Preston",
  "United Braeside",
];

export function readReceiptOffline(fileSizeBytes: number): {
  litres: number;
  cost: number;
  station: string;
} {
  const size = Math.max(0, Math.floor(fileSizeBytes));
  const litres = Math.round((45 + (size % 300) / 10) * 10) / 10; // 45.0–74.9 L
  const perLitre = 1.75 + (size % 40) / 100; // $1.75–$2.14
  const cost = Math.round(litres * perLitre * 100) / 100;
  return { litres, cost, station: RECEIPT_STATIONS[size % RECEIPT_STATIONS.length] };
}

/** L/100km per fuel log, from the odo delta since the previous fill. */
export function fuelEconomy(logs: VehicleLog[]): Record<string, number> {
  const out: Record<string, number> = {};
  const fills = logs
    .filter((l) => l.kind === "fuel" && typeof l.odo === "number" && (l.litres ?? 0) > 0)
    .sort((a, b) => b.ago - a.ago); // oldest → newest
  for (let i = 1; i < fills.length; i++) {
    const dist = (fills[i].odo as number) - (fills[i - 1].odo as number);
    if (dist <= 0) continue;
    const e = ((fills[i].litres as number) / dist) * 100;
    if (e >= 2 && e <= 40) out[fills[i].id] = Math.round(e * 10) / 10;
  }
  return out;
}

/* ---- register filtering / sorting ---- */

export type FleetTab = "all" | "attention" | "pool" | "sold";
export type FleetSort = "attention" | "name" | "value";

export function filterVehicles(
  vehicles: Vehicle[],
  logs: VehicleLog[],
  tab: FleetTab,
  query: string,
  staffName: (id: string | null) => string,
): Vehicle[] {
  const q = query.trim().toLowerCase();
  return vehicles.filter((v) => {
    if (tab === "sold") {
      if (v.status !== "sold") return false;
    } else {
      if (v.status === "sold") return false;
      if (tab === "attention" && vehicleChips(v, openIssueCount(logs, v.id)).length === 0) return false;
      if (tab === "pool" && v.assignedTo !== null) return false;
    }
    if (!q) return true;
    const hay = `${v.name} ${v.make} ${v.model} ${v.plate} ${staffName(v.assignedTo)}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortVehicles(vehicles: Vehicle[], logs: VehicleLog[], sort: FleetSort): Vehicle[] {
  const rank: Record<ChipState, number> = { bad: 0, warn: 1, ok: 2 };
  return [...vehicles].sort((a, b) => {
    if (sort === "value") return b.value - a.value;
    if (sort === "attention") {
      const wa = rank[worstState(vehicleChips(a, openIssueCount(logs, a.id)))];
      const wb = rank[worstState(vehicleChips(b, openIssueCount(logs, b.id)))];
      if (wa !== wb) return wa - wb;
    }
    return displayName(a).localeCompare(displayName(b));
  });
}

/** Book + Tiff totals across the working fleet (sold excluded from both). */
export function fleetValue(vehicles: Vehicle[]): number {
  return vehicles.filter((v) => v.status !== "sold").reduce((sum, v) => sum + v.value, 0);
}

/** Sum of Tiff point estimates across valued working vehicles; null until any exist. */
export function fleetAiValue(
  vehicles: Vehicle[],
  aiValues: Record<string, AiValuation>,
): number | null {
  const points = vehicles
    .filter((v) => v.status !== "sold")
    .map((v) => aiValues[v.id]?.point)
    .filter((n): n is number => typeof n === "number");
  if (points.length === 0) return null;
  return points.reduce((a, b) => a + b, 0);
}

/* ---- small helpers ---- */

export function fmtKm(n: number): string {
  return Math.round(n).toLocaleString("en-AU");
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

/** Money with cents — fuel dockets ($158.40). */
export function fmtCost(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* Whole days from today to an ISO date (negative = past). The implementation
   moved to lib/au-dates.ts, beside the `todayInAu` that has to produce its
   second argument; this re-export keeps fleet's own callers pointed here. */
export { daysUntil } from "@/lib/au-dates";

/** Stable unique id from a name/plate ("VRF 09" → "vrf-09", "vrf-09-2" if taken). */
export function slugId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vehicle";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
