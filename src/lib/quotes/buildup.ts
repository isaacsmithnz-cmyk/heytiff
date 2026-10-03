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
   Tested against 40-odd real jobs at one business's settings — see
   past-jobs.test.ts.

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
  qty: number;
  /** what one costs to buy */
  unitBuyCents: number;
  kind: LineKind;
  /** a figure Tiff assumed, to be confirmed ("15 m", "6 m per zone") */
  assumed?: string | null;
  /** counts toward the duct contingency */
  duct?: boolean;
  /** a swap group this line can be exchanged within */
  swap?: string | null;
  /** why it's here, when another choice put it here */
  because?: string | null;
};

export type VisitStage = "Site measure" | "Rough-in" | "Install" | "Fit-off" | "Commissioning" | "Return";
export const VISIT_STAGES: VisitStage[] = ["Site measure", "Rough-in", "Install", "Fit-off", "Commissioning", "Return"];

/** A trip to site: how many people, for how many days (halves allowed). */
export type Visit = { stage: VisitStage; people: number; days: number };

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
    const sellCents = markup(buyCents, l.kind === "unit" ? s.unitMarkupPct : s.materialMarkupPct);
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
    return { ...v, personDays, sellCents: Math.round(personDays * s.dayHours * s.chargeOutCents) };
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

/* ── the ducted layout without a drawing ─────────────────────────────────
   Trunks come off the nose cone and step down through BTOs and Ys until
   each zone has its own run (Isaac, job 2330: "two 14-inch off the front,
   then a 14-12-10 and a 12-10-10, and a 14-10-10 — five 10-inch grilles").
   AAD's fitting codes spell the sizes in inches: MY141010 is a Y at
   14-10-10, MB141210 a BTO at 14-12-10. A trunk carries up to three zones. */

/** Inches as AAD's codes write them, for a duct in millimetres. */
export const INCH_OF_MM: Record<number, number> = { 150: 6, 200: 8, 250: 10, 300: 12, 350: 14, 400: 16, 450: 18 };

export type Trunk = { mm: number; zones: number; fittings: string[] };

/** The trunks for N zones of one size: each trunk 350, up to three zones
    each, the fittings named by their AAD codes. */
export function ductTrunks(zones: number, zoneMm = 250): Trunk[] {
  const z = INCH_OF_MM[zoneMm] ?? 10;
  const out: Trunk[] = [];
  let left = Math.max(0, Math.round(zones));
  while (left > 0) {
    /* never leave a trunk with a single zone behind a three */
    const take = left === 4 ? 2 : Math.min(3, left);
    const fittings =
      take === 3 ? [`MB1412${z}`, `MY12${z}${z}`] : take === 2 ? [`MY14${z}${z}`] : [];
    out.push({ mm: 350, zones: take, fittings });
    left -= take;
  }
  return out;
}

/* ── the return grille, from the unit's airflow ─────────────────────────── */

export type ReturnSize = { wMm: number; hMm: number };

/** The air speed through a return, in m/s, for an airflow in L/s. */
export function faceVelocity(airflowLs: number, r: ReturnSize): number {
  return airflowLs / 1000 / ((r.wMm / 1000) * (r.hMm / 1000));
}

/** The smallest standard return at or under the target speed; the biggest
    one when none is (two returns are then worth a look). */
export function recommendReturn(airflowLs: number, sizes: ReturnSize[], targetMs = 2.0): ReturnSize | null {
  if (sizes.length === 0) return null;
  const byArea = [...sizes].sort((a, b) => a.wMm * a.hMm - b.wMm * b.hMm);
  return byArea.find((r) => faceVelocity(airflowLs, r) <= targetMs + 1e-9) ?? byArea[byArea.length - 1]!;
}

/** Isaac's standard filtered returns (2026-09-30). */
export const STANDARD_RETURNS: ReturnSize[] = [
  { wMm: 900, hMm: 400 },
  { wMm: 900, hMm: 450 },
  { wMm: 900, hMm: 500 },
  { wMm: 900, hMm: 550 },
  { wMm: 750, hMm: 550 },
];

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

/* ── what the customer sees when they ask for a breakdown ─────────────────
   Every line at its price, and the amounts that are ours alone — the
   difficulty loading, the duct contingency, and a discount we chose to give —
   spread across all of them in proportion, so the lines add up to the price
   offered and nothing in it is named. Our own breakdown keeps them as lines
   (the loading as a grey one, with a note that it's hidden from the client).
   Rounded by largest remainder, so the lines sum to the cent. */

export type CustomerLine = { group: string; name: string; qty: number; sellCents: number };
export type CustomerBreakdown = { lines: CustomerLine[]; exGstCents: number; hiddenCents: number };

export function customerBreakdown(b: BuildUp): CustomerBreakdown {
  const base: CustomerLine[] = [
    ...b.groups.flatMap((g) => g.lines.map((l) => ({ group: g.name, name: l.name, qty: l.qty, sellCents: l.sellCents }))),
    ...b.labour.visits.map((v) => ({ group: "Labour", name: v.stage, qty: v.personDays, sellCents: v.sellCents })),
  ].filter((l) => l.sellCents > 0);
  const baseSum = base.reduce((a, l) => a + l.sellCents, 0);
  const hidden = b.exGstCents - baseSum;
  if (baseSum <= 0 || hidden === 0) return { lines: base, exGstCents: b.exGstCents, hiddenCents: hidden };

  const shares = base.map((l) => (l.sellCents / baseSum) * hidden);
  const floors = shares.map((x) => Math.floor(x));
  let left = hidden - floors.reduce((a, x) => a + x, 0);
  const order = shares.map((x, i) => [x - Math.floor(x), i] as const).sort((a, c) => c[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return { lines: base.map((l, i) => ({ ...l, sellCents: l.sellCents + floors[i]! })), exGstCents: b.exGstCents, hiddenCents: hidden };
}
