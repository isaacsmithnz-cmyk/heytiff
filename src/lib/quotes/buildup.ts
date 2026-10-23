/* THE BUILD-UP — what a quote costs, line by line, and what it sells for.

   A quote's price is built, never typed: every unit and component is a line
   priced from the price book (units at the unit markup, everything else at
   the materials markup), labour is the site visits added up (each a stage,
   people and days, at the day rate — travel is inside it), and the duct
   contingency covers what a layout almost always changes into on site: a
   share of the ductwork and grilles, and a couple of hours at the hourly
   rate.

   Labour is counted as ServiceM8's quotes count it: one person for one day
   at the business's own day rate, in half days. There is no default
   rate, markup or contingency: each is the business's (Isaac, 2026-10-04).

   Pure: the quote screen, the proposal's price and the tests all read the
   same sums. */

export type LineKind = "unit" | "material";

export type BuildLine = {
  /** stable within a build-up: "outdoor", "zone-dampers" */
  key: string;
  group: string;
  name: string;
  /** the price-book code it's priced from; null for an allowance */
  code: string | null;
  supplierKey: string | null;
  /** the supplier's name, where the line says who it's bought from (a unit) */
  supplierName?: string;
  qty: number;
  /** what one costs to buy */
  unitBuyCents: number;
  /** what one sells for, when a person set it on the quote; absent: the buy
      price at the business's markup (the engine rebuild's lines, lines.ts) */
  unitSellCents?: number | null;
  kind: LineKind;
  /** a figure Tiff assumed, to be confirmed ("15 m", "6 m per zone") */
  assumed?: string | null;
  /** counts toward the duct contingency */
  duct?: boolean;
  /** a swap group this line can be exchanged within */
  swap?: string | null;
  /** why it's here, when another choice put it here */
  because?: string | null;
  /** what a unit's order code says it has, in a client's words: "Wi-Fi built in" */
  features?: string[];
};

export type VisitStage = "Site measure" | "Rough-in" | "Install" | "Fit-off" | "Commissioning" | "Return";
export const VISIT_STAGES: VisitStage[] = ["Site measure", "Rough-in", "Install", "Fit-off", "Commissioning", "Return"];

/** A trip to site: how many people, for how many days (halves allowed).
    `rateCents`: an hour sold at a rate a person set on the quote; absent,
    the business's charge-out rate. */
export type Visit = { stage: VisitStage; people: number; days: number; rateCents?: number };

export type BuildSettings = {
  unitMarkupPct: number;
  materialMarkupPct: number;
  /** the business's install charge-out rate, cents an hour */
  chargeOutCents: number;
  /** its working day: one person's day on site is the rate times these
      hours (Isaac, 2026-10-04 — org-day.ts) */
  dayHours: number;
  /** the duct contingency, when the business uses one: a share of the duct
      lines, and hours on top at the rate */
  contingency: { pct: number; hours: number } | null;
};

export type PricedLine = BuildLine & { buyCents: number; sellCents: number };
export type PricedGroup = { name: string; lines: PricedLine[]; buyCents: number; sellCents: number };

/** A hard job's loading on its labour, with the reason it's there (3304: a
    pool-room swap with a scissor lift and commercial ductwork). Kept on the
    quote as a decision, never shown to the client as a line. */
export type Loading = { pct: number; reason: string };

/** A price offered below the build-up, to win the job (2749 went at $9,900
    against a build-up near $12,000 and cost us). The gap is a cost we chose,
    so it needs a reason, and it shows on our side as a discount. */
export type Offered = { exGstCents: number; reason: string };

export type BuildUp = {
  groups: PricedGroup[];
  contingency: { buyCents: number; sellCents: number; hours: number } | null;
  loading: (Loading & { sellCents: number }) | null;
  /** a loading was asked for with no reason, so it isn't applied */
  loadingNeedsReason: boolean;
  /** the price offered below the build-up, and what that gives away */
  offered: (Offered & { discountCents: number }) | null;
  /** an offered price with no reason, or above the build-up, isn't applied */
  offeredNeedsReason: boolean;
  /** what the lines add up to before an offered price */
  buildExGstCents: number;
  labour: { personDays: number; hours: number; sellCents: number; visits: (Visit & { personDays: number; sellCents: number })[] };
  buyCents: number;
  exGstCents: number;
  gstCents: number;
  incGstCents: number;
};

const markup = (cents: number, pct: number) => Math.round(cents * (1 + pct / 100));

/** Every line priced, grouped in the order they first appear, with the
    contingency and the visits added up. */
export function priceBuildUp(
  lines: BuildLine[],
  visits: Visit[],
  s: BuildSettings,
  loadingIn: Loading | null = null,
  offeredIn: Offered | null = null
): BuildUp {
  const groups: PricedGroup[] = [];
  let buy = 0;
  let sell = 0;
  let ductBuy = 0;
  for (const l of lines) {
    const buyCents = Math.round(l.unitBuyCents * l.qty);
    const sellCents =
      l.unitSellCents != null ? Math.round(l.unitSellCents * l.qty) : markup(buyCents, l.kind === "unit" ? s.unitMarkupPct : s.materialMarkupPct);
    let g = groups.find((x) => x.name === l.group);
    if (!g) groups.push((g = { name: l.group, lines: [], buyCents: 0, sellCents: 0 }));
    g.lines.push({ ...l, buyCents, sellCents });
    g.buyCents += buyCents;
    g.sellCents += sellCents;
    buy += buyCents;
    sell += sellCents;
    if (l.duct && l.kind === "material") ductBuy += buyCents;
  }

  let contingency: BuildUp["contingency"] = null;
  /* only ductwork carries it: a wall split has none to cover */
  if (s.contingency && ductBuy > 0) {
    const cBuy = Math.round((ductBuy * s.contingency.pct) / 100);
    contingency = { buyCents: cBuy, sellCents: markup(cBuy, s.materialMarkupPct), hours: s.contingency.hours };
    buy += contingency.buyCents;
    sell += contingency.sellCents;
  }

  const visitRows = visits.map((v) => {
    const personDays = Math.max(0, v.people) * Math.max(0, v.days);
    return { ...v, personDays, sellCents: Math.round(personDays * s.dayHours * (v.rateCents ?? s.chargeOutCents)) };
  });
  const personDays = visitRows.reduce((a, v) => a + v.personDays, 0);
  const hours = contingency?.hours ?? 0;
  const visitsSell = visitRows.reduce((a, v) => a + v.sellCents, 0);
  const labourSell = visitsSell + Math.round(hours * s.chargeOutCents);
  const asked = !!loadingIn && loadingIn.pct > 0;
  const loading =
    asked && loadingIn.reason.trim()
      ? { pct: loadingIn.pct, reason: loadingIn.reason.trim(), sellCents: Math.round((visitsSell * loadingIn.pct) / 100) }
      : null;

  const buildExGst = sell + labourSell + (loading?.sellCents ?? 0);
  const below = !!offeredIn && offeredIn.exGstCents > 0 && offeredIn.exGstCents < buildExGst;
  const offered =
    below && offeredIn!.reason.trim()
      ? { exGstCents: offeredIn!.exGstCents, reason: offeredIn!.reason.trim(), discountCents: buildExGst - offeredIn!.exGstCents }
      : null;
  const exGst = offered ? offered.exGstCents : buildExGst;
  const gst = Math.round(exGst / 10);
  return {
    groups,
    contingency,
    loading,
    loadingNeedsReason: asked && !loading,
    offered,
    offeredNeedsReason: below && !offered,
    buildExGstCents: buildExGst,
    labour: { personDays, hours, sellCents: labourSell, visits: visitRows },
    buyCents: buy,
    exGstCents: exGst,
    gstCents: gst,
    incGstCents: exGst + gst,
  };
}

/* ── the wall bracket, by the outdoor's size ───────────────────────────────
   A 160 kg bracket carries a PUZ-ZM125 by weight but doesn't fit it: the
   bracket goes by the unit's width as well (Isaac, 2026-09-30). */
export function wallBracketCode(outdoorWidthMm: number | null, outdoorWeightKg: number | null): string {
  if ((outdoorWidthMm ?? 0) > 900 || (outdoorWeightKg ?? 0) > 150) return "CWBX";
  return "CWB180";
}

/** Colorbond trunking: 2.4 m lengths cut on site, no fittings, charged by
    the half length (a wall split's run is 1.5 of them; the rest of the
    length goes on the next job). */
export const trunkingLengths = (metres: number) => Math.max(0, Math.ceil(metres / 1.2 - 1e-9) / 2);
