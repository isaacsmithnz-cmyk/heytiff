/* THE DUCTED AIRFLOW GUIDE, BUILT FROM ITS EVIDENCE (data/guides/airflow@<v>/).

   Isaac, 2026-10-15: "build a section in the data pack that recommended
   airflow numbers go through. So she has something to compare it with…
   Just make it very universal, do plenty of research and get the averages.
   From what everyone says… it would be good to have a table to work off."
   And: "this needs to be universal. Anyone using it should get the same
   recommendations, which we can change during the conversation."

   The research is the guide's evidence/ folder: every source and every
   figure it read, as gathered. This turns it into the tables the app reads,
   the same bytes every time (scripts/build-airflow-guide.mts writes them; a
   test rebuilds and compares), so every average traces to the rows it came
   from and is redone when a source is added.

   THE METHOD, for every figure: one value per independent publisher (a copy
   of another's table counts once, with the original; where one publisher
   gives several figures for the same thing, its value is their median), the
   MEDIAN of those as the recommendation, with the mean, the low, the high and
   how many publishers. Every number is read from an evidence row or worked
   from them, said so where it's worked (`derived`); a value nothing gives is
   left out.

   Pure and self-contained (no app imports, no `@/`): node runs it straight
   from the script, by its file name. */

/* ── the evidence, as the research files hold it ── */

type Row = Record<string, unknown>;
type SourceRow = { id: string; publisher: string; title: string; year?: number | null; page?: string; url: string; region: string; confidence: string; basis?: string; notes?: string; status?: string };
export type Evidence = {
  flex: { sources: SourceRow[]; values: Row[] };
  outlets: { sources: SourceRow[]; values: Row[]; rejected: string[] };
  return: { sources: SourceRow[]; values: Row[]; rejected: { source: string; reason: string }[] };
  mains: { sources: SourceRow[]; values: Row[]; extras: Row[] };
};
export type EvidenceFile = keyof Evidence;
export const EVIDENCE_FILES: Record<EvidenceFile, string> = { flex: "flex.json", outlets: "outlets.json", return: "return.json", mains: "mains-zoning.json" };

/* ── numbers ── */

/** Rounded half away from zero, the same on every machine. */
export const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(Math.abs(x) * f + 1e-9) / f * Math.sign(x) || 0;
};
const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** A round duct's area, m², by its diameter in mm. */
export const roundArea = (dMm: number) => (Math.PI / 4) * (dMm / 1000) ** 2;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const must = <T>(v: T | undefined | null, what: string): T => {
  if (v == null) throw new Error(`The evidence has no ${what}`);
  return v;
};

/** Log-log between a source's own two nearest points; nothing outside them. */
function logInterp(points: readonly { x: number; y: number }[], x: number): number | null {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const hit = pts.find((p) => p.x === x);
  if (hit) return hit.y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.x < x && x < b.x) return Math.exp(Math.log(a.y) + (Math.log(x / a.x) / Math.log(b.x / a.x)) * Math.log(b.y / a.y));
  }
  return null;
}

/* ── the sources: one entry a document, one publisher a group ── */

/** What a figure was read from: the source, its value, and how. */
export type From = { source: string; value: number; basis: string; bound?: "lower" };

/** The same document read for more than one topic, under one id. The rest
    keep their evidence id, hyphened. */
const SAME_DOCUMENT: Record<string, string[]> = {
  "actronair-0520-026": ["flex:actronair-0520-026-v1", "outlets:actronair_vaf_3ms", "return:actron_0520_026", "mains:actron_0520_026"],
  "actronair-db0817": ["flex:actronair-db0817-v1.7", "outlets:actronair_builders", "return:actron_db0817", "mains:actron_db0817"],
  /* the same "Verifying ACCA Manual D Procedures" sheet, on two hosts */
  "acca-manual-d": ["flex:acca-manual-d-table-3-1", "outlets:acca_manual_d_t31", "return:acca_manual_d", "mains:acca_manD_ahri"],
  "airah-sw022": ["flex:airah-skills-workshop-22-2009", "mains:airah_sw022"],
  "ncc-2022-j6d5": ["flex:ncc-2022-j6d5", "mains:ncc2022_j6d5"],
  "ashrae-a23-ch49": ["outlets:ashrae_a23_ch49_t9", "return:ashrae_a23_ch49"],
  "brivis-starpro": ["flex:brivis-starpro-install-2016", "mains:brivis_sp"],
  "holyoake-section-d": ["outlets:holyoake_cra", "outlets:holyoake_cmp"],
  "daikin-accessories-2026": ["outlets:daikin_au_round", "outlets:daikin_au_bevelled", "outlets:daikin_au_rcddr", "outlets:daikin_au_rcls"],
};
const CANON = new Map(Object.entries(SAME_DOCUMENT).flatMap(([id, refs]) => refs.map((ref) => [ref, id] as const)));
const canon = (file: EvidenceFile, id: string) => CANON.get(`${file}:${id}`) ?? id.replace(/_/g, "-").toLowerCase();

/** Documents by one publisher count once between them. By the guide's id; a
    source not named is a publisher of its own. */
const PUBLISHER: Record<string, string> = {
  "actronair-0520-026": "ActronAir",
  "actronair-db0817": "ActronAir",
  "advantage-air-tech-specs": "Advantage Air",
  "advantage-air-sunline": "Advantage Air",
  "advantage-air-silhouette": "Advantage Air",
  "aa-purtech": "Advantage Air",
  "aa-slimline": "Advantage Air",
  "aa-zs2": "Advantage Air",
  "aa-myair5": "Advantage Air",
  /* a dealer's terms, reproducing Advantage Air's own guidance */
  "aussieair-myair4": "Advantage Air",
  "ashrae-a23-ch49": "ASHRAE",
  "ashrae-f01-via-krueger": "ASHRAE",
  "ashrae1972-amca": "ASHRAE",
  "ashrae-hof21-amca": "ASHRAE",
  "acca-manual-d": "ACCA",
  "acca-zr-draft": "ACCA",
  "airah-sw022": "AIRAH",
  "airah-sw023": "AIRAH",
  "airah-ncc2025-resp": "AIRAH",
  "airah-eco2020": "AIRAH",
  "ncc-2022-j6d5": "ABCB",
  "abcb-ncc2025-fan": "ABCB",
  "polyaire-fd-1.1-1999": "Polyaire",
  "polyaire-uk-round": "Polyaire",
  "polyaire-au-lfd": "Polyaire",
  "polyaire-au-lsd": "Polyaire",
  "polyaire-au-catalogue": "Polyaire",
  "polyaire-ragx": "Polyaire",
  "polyaire-at4": "Polyaire",
  "polyaire-at5": "Polyaire",
  "polyaire-zm2014": "Polyaire",
  "polyaire-pdf": "Polyaire",
  "holyoake-section-d": "Holyoake",
  "holyoake-dd": "Holyoake",
  "holyoake-rl": "Holyoake",
  "holyoake-amg": "Holyoake",
  "holyoake-dg": "Holyoake",
  "holyoake-spiroflex-bpir-2024": "Holyoake",
  "price-rcd": "Price",
  "price-scd": "Price",
  "price-sds": "Price",
  "price-80": "Price",
  "price-stg": "Price",
  "titus-tmr": "Titus",
  "titus-tms": "Titus",
  /* Daikin Australia's accessories are QAE's: its floor grille table is QAE's own */
  "daikin-accessories-2026": "QAE",
  "qae-fg": "QAE",
  "airfoil-pcd": "Airfoil",
  "airfoil-bgf": "Airfoil",
  "airfoil-lsd": "Airfoil",
  "airfoil-hr5f": "Airfoil",
  "airfoil-dg": "Airfoil",
  "hart-cooley-flex-ed6-2014": "Hart & Cooley",
  "hart-cooley-421": "Hart & Cooley",
  "hart-cooley": "Hart & Cooley",
  "brivis-starpro": "Brivis",
  "brivis-classic": "Brivis",
  "ccc-memo": "CCC Engineering",
  "as4254-ccc": "CCC Engineering",
};
const publisherOf = (id: string) => PUBLISHER[id] ?? id;

/** Read, never averaged, and why: the guide takes no figure from a blog, an
    unsourced table, a retailer or a search snippet (its AGENTS.md). */
export const NOT_AVERAGED: Record<string, string> = {
  "hvacrschool-bruner": "A trade blog.",
  "hvacrschool-paths": "A trade blog summarising Manual D; the table itself wasn't read.",
  "hvacschool-velocity": "A trade blog.",
  "engtoolbox-sizing": "A reference website's unsourced table.",
  "ev-filterbox": "A blog article.",
  "gba-undercut": "A blog article citing a study that wasn't read.",
  koolair: "Read from a search snippet only; the page wasn't reachable.",
  zoningsupply: "A retailer's advice page.",
  "ashrae-fundamentals-flex-roughness-derived": "Worked by the research from ASHRAE's roughness, not published: a cross-check only.",
};

/** A figure: the median of one value a publisher, with its spread. */
export type Figure = { value: number; mean: number; low: number; high: number; n: number; unit: string; from: From[] };

function figure(from: readonly From[], unit: string, dp: number): Figure {
  const groups = new Map<string, number[]>();
  for (const f of from) {
    if (NOT_AVERAGED[f.source]) throw new Error(`${f.source} is never averaged`);
    const k = publisherOf(f.source);
    groups.set(k, [...(groups.get(k) ?? []), f.value]);
  }
  const each = [...groups.values()].map(median);
  if (each.length === 0) throw new Error(`A figure in ${unit} with no sources`);
  return {
    value: round(median(each), dp),
    mean: round(mean(each), dp),
    low: round(Math.min(...each), dp),
    high: round(Math.max(...each), dp),
    n: each.length,
    unit,
    from: from.map((f) => ({ ...f, value: round(f.value, 3) })),
  };
}

/* ── reading the evidence ── */

const rowsOf = (ev: Evidence, file: EvidenceFile): Row[] => (file === "mains" ? [...ev.mains.values, ...ev.mains.extras] : ev[file].values);

/** The rows of one source on one item; the predicate narrows further. */
function pick(ev: Evidence, file: EvidenceFile, source: string, item: string | null, where: (x: Row) => boolean = () => true): Row[] {
  return rowsOf(ev, file).filter((x) => x.source === source && (item == null || x.item === item) && where(x));
}
/** Exactly one row, or the build stops: a changed research file is noticed. */
function one(ev: Evidence, file: EvidenceFile, source: string, item: string | null, where: (x: Row) => boolean = () => true): Row {
  const got = pick(ev, file, source, item, where);
  if (got.length !== 1) throw new Error(`The evidence has ${got.length} rows of ${source} ${item ?? ""}, not one`);
  return got[0]!;
}
const valueOf = (x: Row, key = "value") => must(num(x[key]), `${String(x.source)} ${key}`);
const rangeTop = (x: Row) => must(num((x.range_ms as unknown[] | undefined)?.[1]), `${String(x.source)} range`);
const from = (file: EvidenceFile, x: Row, value: number, basis: string): From => ({ source: canon(file, String(x.source)), value, basis, ...(x.bound === "lower" ? { bound: "lower" as const } : {}) });

/* ════════════════════════ flexible duct ════════════════════════ */

export const FLEX_SIZES = [100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500] as const;
/** The friction the charts and equations are read at: the NCC's cap on an
    index run's average (J6D5), and where Advantage Air's own table sits. */
const FLEX_PA_M = 1.0;

export type FlexRow = {
  dia_mm: number;
  recommended_ls: number;
  velocity_ms: number;
  most_ls: number;
  most_from: string;
  capped?: string;
  median_ls: number;
  mean_ls: number;
  low_ls: number;
  high_ls: number;
  n: number;
  ls_at_1pa_m: number | null;
  from: From[];
};

function buildFlex(ev: Evidence) {
  const v = ev.flex.values;
  const rows = (src: string, ok: (x: Row) => boolean) => v.filter((x) => x.source === src && ok(x));
  const pts = (src: string, ok: (x: Row) => boolean) => rows(src, ok).map((x) => ({ x: valueOf(x, "dia_mm"), y: valueOf(x, "max_ls") }));
  const at1 = (x: Row) => x.kind === "at_friction" && x.friction_pa_m === FLEX_PA_M && x.basis_type !== "published_example";
  const all = () => true;

  /* each publisher's L/s for a diameter, and how it was got */
  /* a table of the sizes it sells is read at those sizes only; an inch
     source between its own, to the metric size */
  const readers: { source: string; basis: string; points: { x: number; y: number }[]; exactOnly?: true }[] = [
    { source: "advantage-air-tech-specs", basis: "published maximum", points: pts("advantage-air-tech-specs", all), exactOnly: true },
    { source: "actronair-0520-026", basis: "its 3.0 m/s rule × the area", points: pts("actronair-0520-026-v1", all) },
    { source: "airah-sw022", basis: "its 3.5 m/s rule × the area", points: pts("airah-skills-workshop-22-2009", all) },
    { source: "acca-manual-d", basis: "its recommended 600 fpm (3.05 m/s) × the area", points: pts("acca-manual-d-table-3-1", (x) => x.kind === "recommended") },
    { source: "nci-via-cee-duct-retrofit-guide-2024", basis: "published", points: pts("nci-via-cee-duct-retrofit-guide-2024", all) },
    { source: "hart-cooley-flex-ed6-2014", basis: "its friction chart at 1 Pa/m", points: pts("hart-cooley-flex-ed6-2014", at1) },
    { source: "atco-friction-calculator-2022", basis: "its friction equation at 1 Pa/m", points: pts("atco-friction-calculator-2022", at1) },
    { source: "lbnl-abushakra-2002", basis: "its measured fully stretched loss at 1 Pa/m", points: pts("lbnl-abushakra-2002", at1) },
    { source: "manrose-securimax-duct-catalogue-2016", basis: "its friction chart at 1 Pa/m", points: pts("manrose-securimax-duct-catalogue-2016", at1) },
    { source: "polyaire-fd-1.1-1999", basis: "its friction chart at 1 Pa/m", points: pts("polyaire-fd-1.1-1999", at1) },
  ];
  const charts = ["hart-cooley-flex-ed6-2014", "atco-friction-calculator-2022", "lbnl-abushakra-2002", "manrose-securimax-duct-catalogue-2016", "polyaire-fd-1.1-1999"];

  /* the published maximum: Advantage Air's table, which ActronAir reprints
     and carries down to 100, 125 and 175 */
  const aa = new Map(pts("advantage-air-tech-specs", all).map((p) => [p.x, p.y]));
  const actron = new Map(pts("actronair-db0817-v1.7", all).map((p) => [p.x, p.y]));

  const table: FlexRow[] = FLEX_SIZES.map((d) => {
    const got: From[] = readers.flatMap((s) => {
      const exact = s.points.some((p) => p.x === d);
      const q = exact || !s.exactOnly ? logInterp(s.points, d) : null;
      return q == null ? [] : [{ source: s.source, value: q, basis: exact ? s.basis : `${s.basis}, log-interpolated to ${d} mm` }];
    });
    const f = figure(got, "L/s", 0);
    const most = must(aa.get(d) ?? actron.get(d), `published maximum for ${d} mm flex`);
    const recommended = Math.min(f.value, most);
    const ones = got.filter((g) => charts.includes(g.source)).map((g) => g.value);
    return {
      dia_mm: d,
      recommended_ls: recommended,
      velocity_ms: round(recommended / 1000 / roundArea(d), 2),
      most_ls: most,
      most_from: aa.has(d) ? "advantage-air-tech-specs" : "actronair-db0817",
      ...(recommended < f.value ? { capped: `The publishers' median, ${f.value} L/s, is over the published maximum: the recommendation is the maximum.` } : {}),
      median_ls: f.value,
      mean_ls: f.mean,
      low_ls: f.low,
      high_ls: f.high,
      n: f.n,
      ls_at_1pa_m: ones.length ? round(median(ones), 0) : null,
      from: f.from,
    };
  });

  /* how loss grows with flow, Q ∝ (Pa/m)^k: k from each chart or equation's
     own pairs of rows at the two frictions it was read at */
  const ks: From[] = charts.flatMap((src) => {
    const lo = rows(src, (x) => x.kind === "at_friction" && x.friction_pa_m !== FLEX_PA_M && x.basis_type !== "published_example");
    const each = lo.flatMap((x) => {
      const hi = rows(src, (y) => at1(y) && y.dia_mm === x.dia_mm)[0];
      return hi ? [Math.log(valueOf(hi, "max_ls") / valueOf(x, "max_ls")) / Math.log(FLEX_PA_M / valueOf(x, "friction_pa_m"))] : [];
    });
    return each.length ? [{ source: src, value: median(each), basis: `its own L/s at ${String(lo[0]!.friction_pa_m)} and ${FLEX_PA_M} Pa/m, ${each.length} sizes` }] : [];
  });

  return {
    about:
      "Flexible duct, one run: what a diameter should carry. recommended_ls is the median of one figure a publisher (its published L/s, its friction chart or equation read at 1 Pa/m, or its velocity rule times the duct's area: `from` says which), never more than the published maximum. most_ls is that maximum, Advantage Air's table as ActronAir reprints it. velocity_ms is at the recommendation. ls_at_1pa_m is the charts' and equations' own median, what a run's friction is worked from.",
    friction_pa_m: FLEX_PA_M,
    loss_exponent: { ...figure(ks, "k, in L/s ∝ (Pa/m)^k", 3), about: "How a flex run's loss grows with its flow, fully stretched: Pa/m = (L/s ÷ ls_at_1pa_m)^(1/k)." },
    rows: table,
  };
}

/* ════════════════════════ supply outlets ════════════════════════ */

export const OUTLET_KINDS = ["round_ceiling_diffuser", "square_ceiling_diffuser", "floor_grille", "wall_register", "linear_slot"] as const;
export type OutletKind = (typeof OUTLET_KINDS)[number];
/** Rules, not tested data: kept as notes, out of the medians (as outlets.json's summary_excluding_rules). */
const OUTLET_RULES = new Set(["ashrae_a23_ch49_t9", "actronair_builders", "actronair_vaf_3ms", "acca_manual_d_t31", "polyaire_au_catalogue"]);
const LEVEL: Record<string, 25 | 30> = {
  NC25: 25,
  NR25: 25,
  "LWA35dBA(~NR25)": 25,
  "HC_residence_500fpm(quiet end)": 25,
  NC30: 30,
  NR30: 30,
  "HC_residence_750fpm(upper end)": 30,
};

export type OutletStat = Figure & { neck_velocity_ms: number | null; lower_bounds: number };
export type OutletRow = {
  kind: OutletKind;
  size: string;
  size_mm: number[] | null;
  slots?: number;
  recommended_ls: number;
  most_ls: number;
  neck_velocity_ms: number | null;
  at_nc25: OutletStat;
  at_nc30: OutletStat;
};

/** How the research read an outlet's figure off its maker's table. */
const READ: Record<string, string> = {
  interpolated: "between its table's rows",
  chart_read: "read off its chart",
  interpolated_length_corrected: "between its rows, corrected for the grille's length",
  chart_read_length_corrected: "read off its chart, corrected for the grille's length",
  tabulated_at_guideline_velocity: "its table at its own guideline face velocity",
  tabulated_step: "the first step of its table to reach it",
};

function outletStat(rows: Row[], unit: string): OutletStat {
  const f = figure(
    rows.map((x) => {
      const slot = x.outlet === "linear_slot" ? `, ${String(x.size)}` : "";
      return from("outlets", x, valueOf(x, "ls"), `${String(x.noise)}${slot}, ${READ[String(x.method)] ?? String(x.method)}`);
    }),
    unit,
    0
  );
  const vel = rows.map((x) => num(x.neck_velocity_ms)).filter((x): x is number => x != null);
  return { ...f, neck_velocity_ms: vel.length ? round(median(vel), 2) : null, lower_bounds: rows.filter((x) => x.bound === "lower").length };
}

function sizeMmOf(kind: OutletKind, size: string): number[] | null {
  if (kind === "round_ceiling_diffuser") return [Number(size)];
  const neck = /^round neck (\d+)$/.exec(size);
  if (neck) return [Number(neck[1])];
  const wh = /^(\d+)x(\d+)$/.exec(size);
  return wh ? [Number(wh[1]), Number(wh[2])] : null;
}

function buildOutlets(ev: Evidence) {
  const usable = ev.outlets.values.filter((x) => x.primary !== false && num(x.ls) != null && !OUTLET_RULES.has(String(x.source)) && LEVEL[String(x.noise)] != null);
  const rows: OutletRow[] = [];
  /* round, square, floor and wall: by the size the makers name */
  for (const kind of OUTLET_KINDS) {
    if (kind === "linear_slot") continue;
    for (const size of [...new Set(usable.filter((x) => x.outlet === kind).map((x) => String(x.size)))]) {
      const at = (lv: 25 | 30) => usable.filter((x) => x.outlet === kind && x.size === size && LEVEL[String(x.noise)] === lv);
      const s25 = outletStat(at(25), "L/s");
      const s30 = outletStat(at(30), "L/s");
      if (s30.value < s25.value) throw new Error(`${kind} ${size}: the quieter figure carries more than the louder`);
      rows.push({ kind, size, size_mm: sizeMmOf(kind, size), recommended_ls: s25.value, most_ls: s30.value, neck_velocity_ms: s25.neck_velocity_ms, at_nc25: s25, at_nc30: s30 });
    }
  }
  /* linear slot, a metre a slot, by how many slots: one-way blow, a two-way
     slot being a variant a third or so lower */
  const slots = usable.filter((x) => x.outlet === "linear_slot" && x.blow !== "two-way");
  for (const n of [...new Set(slots.map((x) => valueOf(x, "slots")))].sort((a, b) => a - b)) {
    const at = (lv: 25 | 30) => slots.filter((x) => x.slots === n && LEVEL[String(x.noise)] === lv);
    rows.push({ kind: "linear_slot", size: `${n}-slot`, size_mm: null, slots: n, recommended_ls: outletStat(at(25), "").value, most_ls: outletStat(at(30), "").value, neck_velocity_ms: null, at_nc25: outletStat(at(25), "L/s a metre a slot"), at_nc30: outletStat(at(30), "L/s a metre a slot") });
  }
  const sizeKey = (o: OutletRow) => (o.size.startsWith("round neck") ? 1e7 : 0) + (o.size_mm ? o.size_mm.reduce((a, b) => a * b, 1) : (o.slots ?? 0));
  rows.sort((a, b) => OUTLET_KINDS.indexOf(a.kind) - OUTLET_KINDS.indexOf(b.kind) || sizeKey(a) - sizeKey(b) || a.size.localeCompare(b.size));

  /* the rules, as the publishers state them */
  const neckRule = (lv: string) => valueOf(one(ev, "outlets", "ashrae_a23_ch49_t9", null, (x) => x.outlet === "round_ceiling_diffuser" && x.size === "150" && x.noise === lv), "neck_velocity_ms");
  const boots = ev.outlets.values.filter((x) => x.source === "polyaire_au_catalogue").map((x) => `${String(x.size)} on a ${valueOf(x, "boot_spigot_mm")}`);
  return {
    about:
      "Supply outlets, each: what one should carry. recommended_ls is the median of the makers' tested airflow where the outlet reaches about NC/NR 25 (quiet living rooms and bedrooms), most_ls the same at about NC/NR 30; one figure a maker. Ratings differ between makers (a US NC table allows 10 dB for the room, NR is a few points stricter), which is why the spread is wide. A linear slot is L/s a metre a slot. The neck velocity is on the nominal neck, at the recommendation.",
    rows,
    rules: [
      { rule: `With no maker's sound data, the neck at no more than ${neckRule("RC25")} m/s for RC 25 and ${neckRule("RC30")} m/s for RC 30, and lower where several outlets serve one room.`, sources: ["ashrae-a23-ch49"] },
      { rule: "The flex run feeding an outlet carries no more than the flexible duct table's most for its size.", sources: ["actronair-db0817"] },
      { rule: "On a variable-airflow system, the final run to an outlet at no more than 3 m/s, to keep its noise down; the outlet maker's own data where it has it.", sources: ["actronair-0520-026"] },
      { rule: "An outlet is sized for its throw, its face no faster than 700 fpm (3.56 m/s).", sources: ["acca-manual-d"] },
      { rule: `Floor grille boots: ${boots.join(", ")} mm spigot; a 300x100 mainly for gas heating, its airflow being lower.`, sources: ["polyaire-au-catalogue"] },
    ],
  };
}

/* ════════════════════════ return air ════════════════════════ */

/** A figure that doesn't say its area is read as through the free area: the
    cautious reading, which sizes a grille larger. */
const freeBasis = (x: Row) => x.area_basis !== "gross";
export const RETURN_DUCT_SIZES = [250, 300, 350, 400, 450, 500, 550, 600] as const;

function buildReturn(ev: Evidence) {
  const R = (source: string, item: string | null, where: (x: Row) => boolean = () => true) => pick(ev, "return", source, item, where);
  const O = (source: string, item: string | null, where: (x: Row) => boolean = () => true) => one(ev, "return", source, item, where);
  const pct = (rows: Row[], basis: (x: Row) => string) => rows.map((x) => from("return", x, valueOf(x, "free_area_pct"), basis(x)));

  /* free area, by the kind of grille */
  const eggcrate = figure(
    [
      ...pct(R("airflow_nz", "return_grille_size_ls"), (x) => `its filtered eggcrate ${String(x.size)}, the core`),
      ...pct(R("airfoil_hr5f", "return_grille_size_ls"), (x) => `its hinged eggcrate ${String(x.size)}`),
      ...pct(R("price_80", "return_grille_size_ls"), (x) => `its 80 eggcrate ${String(x.size)}, core ÷ nominal`),
    ],
    "%",
    0
  );
  const filterGrille = figure(pct(R("aa_purtech", "return_grille_size_ls", (x) => x.nr === 25), (x) => `its Purtech ${String(x.size)}, effective face area`), "%", 0);
  const stamped = figure(pct(R("bsc_rr0005", "return_grille_size_ls"), (x) => `a stamped return ${String(x.size)} (Ameri-Flow/Grainger)`), "%", 0);
  const doorGrille = figure(pct(R("airfoil_dg", "transfer_grille"), (x) => `its inverted-V door grille ${String(x.size)}`), "%", 0);
  const kinds = { eggcrate, filter_grille: filterGrille, stamped_or_bar: stamped };
  const fa = eggcrate.value / 100;

  /* ── an open return grille: the published limits, on the free area ── */
  const limit = (x: Row, what: string): From => {
    const v = valueOf(x, "velocity_ms");
    if (freeBasis(x)) return from("return", x, v, `${what}${x.area_basis === "free" ? ", through the free area" : "; the area not said, read as the free area"}`);
    return from("return", x, v / fa, `${what}: ${v} m/s on the gross face ÷ an eggcrate's ${eggcrate.value}% free`);
  };
  const noFilter = figure(
    [
      limit(O("actron_0520_026", "return_grille_face_velocity"), "return grilles sized at it"),
      limit(O("actron_db0817", "return_grille_face_velocity"), "the middle of its 2–2.5 m/s for grille selection"),
      limit(O("ccc_memo", "return_grille_face_velocity"), "a ceiling-plenum return's face below it"),
      limit(O("ashrae_a23_ch49", "return_grille_face_velocity", (x) => x.rc === 30), "the most at a return opening for RC 30"),
      limit(O("ashrae_f01_via_krueger", "return_grille_face_velocity", (x) => /zone, near seats/.test(String(x.note))), "a return inlet in the occupied zone, near seats, the middle"),
      limit(O("acca_manual_d", "return_grille_face_velocity", (x) => num(x.velocity_ms) != null), "a return grille's face, Table 3-1"),
      limit(O("hart_cooley", "return_grille_face_velocity"), "the middle of its 400–600 fpm on the effective area"),
      ...R("brivis_classic", "return_grille_face_velocity").map((x) => limit(x, `the least egg-crate opening for ${String(x.note).split(":")[0]}`)),
    ],
    "m/s",
    2
  );
  const quietOpen = figure([limit(O("ashrae_a23_ch49", "return_grille_face_velocity", (x) => x.rc === 25), "the most at a return opening for RC 25")], "m/s", 2);

  /* ── a filter grille: on its gross face ── */
  const gross = (x: Row, what: string): From => {
    const v = valueOf(x, "velocity_ms");
    if (!freeBasis(x)) return from("return", x, v, `${what}, on the gross face`);
    const own = num(x.free_area_pct);
    const p = own ?? filterGrille.value;
    return from("return", x, (v * p) / 100, `${what}: ${v} m/s ${x.area_basis === "free" ? "through the free area" : "(the area not said, read as the free area)"} × ${own != null ? "its own" : "a filter grille's"} ${p}% free`);
  };
  const filtered = figure(
    [
      ...R("brivis_classic", "filter_face_velocity").map((x) => gross(x, `the least filtered opening for ${String(x.note).split(":")[0]}`)),
      ...R("aa_purtech", "return_grille_size_ls", (x) => x.nr === 25).map((x) => gross(x, `Purtech ${String(x.size)} at NR 25, clean filter`)),
      ...R("aa_slimline", "return_grille_size_ls", (x) => x.nr === 25).map((x) => gross(x, `Slimline ${String(x.size)} at NR 25, clean filter`)),
      gross(O("airflow_nz", "filter_face_velocity"), "the velocity its filter grilles are rated at"),
      gross(O("acca_manual_d", "filter_face_velocity", (x) => num(x.velocity_ms) != null), "a filter grille's face, Table 3-1"),
      gross(O("hart_cooley", "filter_face_velocity"), "filter returns at no more than 450 fpm on the effective area"),
      ...R("hart_cooley", "return_grille_size_ls").map((x) => gross(x, `its filter-size table, ${String(x.size)}`)),
    ],
    "m/s",
    2
  );
  const quietFiltered = figure(
    [
      ...R("aa_purtech", "return_grille_size_ls", (x) => x.nr === 20).map((x) => gross(x, `Purtech ${String(x.size)} at NR 20, clean filter`)),
      ...R("aa_slimline", "return_grille_size_ls", (x) => x.nr === 20).map((x) => gross(x, `Slimline ${String(x.size)} at NR 20, clean filter`)),
    ],
    "m/s",
    2
  );
  const pleated = figure(
    [
      gross(O("cec_2018_filters", "filter_face_velocity", (x) => x.area_basis === "gross" && x.size == null), "Title 24's MERV 13 option, its filter ≤ 0.1 in.wc clean"),
      gross(O("camfil_3030", "filter_face_velocity", (x) => num(x.pressure_pa) == null), "its rated 'medium' velocity, 2 and 4 in pleated"),
    ],
    "m/s",
    2
  );

  /* ── a filter's pressure ── */
  const final = (source: string, basis: string) => {
    const x = O(source, "filter_face_velocity", (y) => /final/i.test(String(y.note)));
    return from("return", x, valueOf(x, "pressure_pa"), basis);
  };
  const change = figure(
    [final("aa_purtech", "G2 electrostatic, its final (dirty) resistance"), final("aa_slimline", "honeycomb, its final resistance"), final("camfil_3030", "MERV 8 pleated, its recommended final resistance")],
    "Pa",
    0
  );

  /* ── the return duct: its velocity, then L/s by diameter ── */
  const models = [...R("actron_0520_026", "return_duct"), ...R("actron_db0817", "return_duct")].filter((x) => /^2x\d+ dia$/.test(String(x.size ?? "")));
  const accaTrunk = O("acca_manual_d", "return_duct", (x) => x.size === "return trunk");
  const ccc = O("ccc_memo", "return_duct");
  const ductDesign = figure(
    [
      ...models.map((x) => from("return", x, valueOf(x, "velocity_ms"), `a model's own return: ${String(x.note)}`)),
      from("return", accaTrunk, valueOf(accaTrunk, "velocity_ms"), "a return trunk, recommended 600 fpm"),
      from("return", ccc, valueOf(ccc, "velocity_ms"), "ducted returns 3.5–5.0 m/s, the middle"),
    ],
    "m/s",
    2
  );
  const actronMost = O("actron_0520_026", "return_duct", (x) => x.size == null);
  const ductMost = figure(
    [
      from("return", actronMost, valueOf(actronMost, "velocity_ms"), "the most in a return duct"),
      from("return", accaTrunk, rangeTop(accaTrunk), "a return trunk, maximum 700 fpm"),
      from("return", ccc, rangeTop(ccc), "ducted returns 3.5–5.0 m/s, the top"),
    ],
    "m/s",
    2
  );

  /* ── the way back from a room with its door shut ── */
  const star3 = O("energystar_rfc14", "transfer_grille", (x) => x.pressure_pa === 3);
  const star5 = O("energystar_rfc14", "transfer_grille", (x) => num(x.ls) != null);
  const bsc = O("bsc_rr0005", "transfer_grille", (x) => x.size == null);
  const cccCut = O("ccc_memo", "transfer_grille", (x) => num(x.ls) != null);
  const roomLimit = figure(
    [
      from("return", star3, valueOf(star3, "pressure_pa"), "a bedroom, doors shut, every air handler on"),
      from("return", bsc, valueOf(bsc, "pressure_pa"), "transfer air sized at it"),
      from("return", cccCut, valueOf(cccCut, "pressure_pa"), "room to corridor"),
    ],
    "Pa",
    1
  );
  const [doorW, cutH] = cccCut.size_mm as [number, number];
  const undercut = figure(
    [
      from("return", cccCut, valueOf(cccCut, "ls"), `a ${cutH} mm undercut on an ${doorW} mm door, at ${valueOf(cccCut, "pressure_pa")} Pa`),
      from("return", bsc, valueOf(bsc, "velocity_ms") * (doorW / 1000) * (cutH / 1000) * 1000, `its ${valueOf(bsc, "velocity_ms")} m/s at ${valueOf(bsc, "pressure_pa")} Pa through ${cutH} × ${doorW} mm (derived)`),
    ],
    "L/s",
    0
  );
  const stg = R("price_stg", "transfer_grille").map((x) => ({ v: valueOf(x, "velocity_ms"), p: valueOf(x, "pressure_pa") })).sort((a, b) => a.p - b.p);
  const lo = must(stg.filter((s) => s.p <= roomLimit.value).at(-1), "a sight-proof grille row under the room limit");
  const hi = must(stg.find((s) => s.p > roomLimit.value), "a sight-proof grille row over the room limit");
  const bscAt = (size: string) => valueOf(O("bsc_rr0005", "transfer_grille", (x) => x.size === size), "velocity_ms");
  const louvre = O("ashrae_f01_via_krueger", "transfer_grille", (x) => x.size === "door or wall louvre");

  /* ── a grille's L/s at the guide's velocities, for the sizes AU and NZ makers name ── */
  const named = new Map<string, { w: number; h: number; by: Set<string> }>();
  for (const src of ["airflow_nz", "aa_purtech", "aa_slimline", "airfoil_hr5f", "holyoake_rl", "holyoake_amg", "polyaire_ragx"])
    for (const x of R(src, null, (y) => /^\d+x\d+$/.test(String(y.size ?? "")))) {
      const [w, h] = String(x.size).split("x").map(Number) as [number, number];
      const was = named.get(`${w}x${h}`) ?? { w, h, by: new Set<string>() };
      named.set(`${w}x${h}`, { ...was, by: was.by.add(canon("return", src)) });
    }
  const openGross = round(noFilter.value * fa, 2);
  const grilles = [...named.values()]
    .sort((a, b) => a.w * a.h - b.w * b.h || a.w - b.w)
    .map(({ w, h, by }) => {
      const m2 = (w / 1000) * (h / 1000);
      return { size: `${w}x${h}`, w_mm: w, h_mm: h, face_m2: round(m2, 4), no_filter_ls: round(m2 * openGross * 1000, 0), filtered_ls: round(m2 * filtered.value * 1000, 0), pleated_ls: round(m2 * pleated.value * 1000, 0), sources: [...by].sort() };
    });

  return {
    about:
      "The return: its grille, its filter, its duct and the way back from each room. Velocities are each publisher's on the area it states; one that doesn't say is read as through the free area, the cautious reading, which sizes a grille larger. A grille named by its face is sized on that gross face, its free area the face times its free-area %.",
    grille_velocity_ms: {
      no_filter_free_area: { ...noFilter, most: noFilter.high, about: "An open return grille (eggcrate, no filter): the air through its free area. most is the publishers' high." },
      no_filter_gross_eggcrate: { value: openGross, most: round(noFilter.high * fa, 2), unit: "m/s", derived: `The free-area figure × an eggcrate's ${eggcrate.value}% free.` },
      filtered_gross: { ...filtered, most: filtered.high, about: "A filter grille with a clean standard (G2-class) filter: the air on its gross face. most is the publishers' high." },
      quiet_bedroom: {
        no_filter_free_area: { ...quietOpen, about: "An open return in or beside a bedroom: the figure a noise rating quieter (RC 25)." },
        filtered_gross: { ...quietFiltered, about: "A filter grille in or beside a bedroom: the figure a noise rating quieter (NR 20)." },
      },
      pleated_high_merv_gross: { ...pleated, about: "A deep pleated or high-MERV filter, run slow for its pressure." },
    },
    free_area_pct: {
      ...kinds,
      door_grille_v_blade: doorGrille,
      default_when_unknown: { value: Math.min(...Object.values(kinds).map((k) => k.value)), unit: "%", derived: "The lowest of the return grille kinds, so a grille nobody knows is never sized too small." },
    },
    filter_pa: {
      clean: cleanFilterDrop(ev),
      change: { ...change, about: "When the filter's due: its final (dirty) resistance, by the kind of filter." },
      ncc_clean_caps: nccFilterCaps(ev),
    },
    return_duct: {
      design_ms: ductDesign,
      most_ms: ductMost,
      by_dia: { derived: "The design and most velocities × each diameter's area.", rows: RETURN_DUCT_SIZES.map((d) => ({ dia_mm: d, design_ls: round(ductDesign.value * roundArea(d) * 1000, 0), most_ls: round(ductMost.value * roundArea(d) * 1000, 0) })) },
    },
    transfer: {
      room_pressure_limit_pa: { ...roomLimit, about: "A room with its door shut, against the return." },
      large_room: { pressure_pa: valueOf(star5, "pressure_pa"), from_ls: valueOf(star5, "ls"), sources: ["energystar-rfc14"], about: "A bedroom whose design airflow is at least from_ls may run to pressure_pa." },
      door_undercut_ls: { ...undercut, about: `A ${cutH} mm undercut on an ${doorW} mm door, at the room limit.` },
      open_grille_free_area_ms: { value: valueOf(bsc, "velocity_ms"), unit: "m/s", n: 1, sources: ["bsc-rr0005"], about: "A straight-through transfer grille, through its free area, at the room limit." },
      jump_duct_free_area_ms: { value: bscAt("through-wall / jump duct"), unit: "m/s", n: 1, sources: ["bsc-rr0005"] },
      high_low_wall_free_area_ms: { value: bscAt("high-low wall transfer"), unit: "m/s", n: 1, sources: ["bsc-rr0005"] },
      sightproof_grille_gross_ms: { value: round(lo.v + ((roomLimit.value - lo.p) / (hi.p - lo.p)) * (hi.v - lo.v), 2), unit: "m/s", n: 1, sources: ["price-stg"], derived: `Its tested velocity at ${roomLimit.value} Pa, between ${lo.v} m/s at ${lo.p} Pa and ${hi.v} m/s at ${hi.p} Pa.` },
      door_louvre_gross_ms: { ...figure([from("return", louvre, valueOf(louvre, "velocity_ms"), "door or wall louvres, 200–300 fpm, the middle")], "m/s", 2), about: "A door or wall louvre, held to it for noise and draught rather than pressure." },
    },
    grille_ls_by_size: {
      derived:
        "Worked, not published: each return grille size AU and NZ makers name, its face × the guide's velocities (open: the eggcrate's gross figure; filtered: the filter grille's; pleated: the high-MERV figure).",
      rows: grilles,
    },
  };
}

/** A clean filter's drop, over every publisher in the evidence: what the
    return's filter and the static budget both use. */
function cleanFilterDrop(ev: Evidence): Figure {
  const F = (source: string, where: (x: Row) => boolean) => pick(ev, "return", source, "filter_face_velocity", (x) => num(x.pressure_pa) != null && where(x));
  const at = (x: Row) => (num(x.velocity_ms) != null ? ` at ${String(x.velocity_ms)} m/s` : "");
  return figure(
    [
      ...F("aa_purtech", (x) => /initial/i.test(String(x.note))).map((x) => from("return", x, valueOf(x, "pressure_pa"), `G2 electrostatic, initial${at(x)}`)),
      ...F("aa_slimline", (x) => /initial/i.test(String(x.note))).map((x) => from("return", x, valueOf(x, "pressure_pa"), `honeycomb, initial${at(x)}`)),
      ...F("camfil_3030", (x) => /initial/i.test(String(x.note))).map((x) => from("return", x, valueOf(x, "pressure_pa"), `MERV 8 pleated, its most initial${at(x)}`)),
      ...F("cec_2018_filters", (x) => Array.isArray(x.pressure_range_pa)).map((x) => from("return", x, valueOf(x, "pressure_pa"), `lab-tested clean${at(x)}, the middle of its range`)),
      ...F("acca_manual_d", () => true).map((x) => from("return", x, valueOf(x, "pressure_pa"), "its worked example's filter")),
    ],
    "Pa",
    1
  );
}

function nccFilterCaps(ev: Evidence) {
  return {
    rows: pick(ev, "mains", "ncc2022_j6d5", "filter_drop").map((x) => ({ class: must(/MERV ?\d+/.exec(String(x.notes))?.[0], "a MERV class"), most_pa: valueOf(x) })),
    sources: ["ncc-2022-j6d5"],
    about: "The NCC's most for a clean filter on an index run (J6D5, Class 2–9 buildings).",
  };
}

/* ════════════════════════ mains, branches and the static ════════════════════════ */

export type RigidRow = {
  dia_mm: number;
  recommended_ls: number;
  velocity_ms: number;
  limited_by: "friction" | "velocity";
  most_ls: number;
  at_design_friction_ls: number;
  low_ls: number;
  high_ls: number;
  n: number;
  from: From[];
};

function buildDucts(ev: Evidence) {
  const M = (source: string, item: string, where: (x: Row) => boolean = () => true) => pick(ev, "mains", source, item, where);
  const O = (source: string, item: string, where: (x: Row) => boolean = () => true) => one(ev, "mains", source, item, where);
  const val = (x: Row, basis: string, value = valueOf(x)) => from("mains", x, value, basis);
  const is = (duct: string, value: number) => (x: Row) => x.duct === duct && x.value === value;

  const velocity = {
    main_rigid: {
      design: figure(
        [
          /* ActronAir gives one main velocity for any duct; its own flex
             table stops at 4 m/s, so its 6–7 m/s is a rigid main's */
          val(O("actron_0520_026", "main_velocity"), "a main 6–7 m/s, the middle (its flex table stops at 4 m/s, so a rigid main's)"),
          val(O("acca_manD_ahri", "main_velocity", is("rigid", 3.56)), "a rigid supply trunk, recommended 700 fpm"),
          val(O("ashrae1972_amca", "main_velocity"), "residences' main ducts 700–900 fpm, the middle"),
          val(O("airah_eco2020", "main_velocity"), "what straight duct designed to 1 Pa/m gives"),
        ],
        "m/s",
        2
      ),
      most: figure(
        [
          val(O("natspec_0741", "main_velocity", (x) => x.duct === "rigid"), "rigid ductwork at most 6 m/s"),
          val(O("acca_manD_ahri", "main_velocity", is("rigid", 4.57)), "a rigid supply trunk, maximum 900 fpm"),
          val(O("carrier_cz2", "main_velocity", (x) => x.duct === "rigid"), "sheet-metal zone mains at most 900 fpm"),
          val(O("nrcan_zoning", "main_velocity"), "a supply trunk at most 900 fpm at design"),
        ],
        "m/s",
        2
      ),
    },
    main_flex: {
      design: figure([val(O("acca_manD_ahri", "main_velocity", is("flex", 3.05)), "a flex supply trunk, recommended 600 fpm")], "m/s", 2),
      most: figure(
        [
          val(O("natspec_0741", "main_velocity", (x) => x.duct === "flex"), "flexible duct at most 4 m/s"),
          val(O("acca_manD_ahri", "main_velocity", is("flex", 3.56)), "a flex supply trunk, maximum 700 fpm"),
          val(O("carrier_cz2", "main_velocity", (x) => x.duct === "flex"), "its 900 fpm main with flex at 1.25 × the area"),
          val(O("nrcan_zoning", "main_velocity"), "a supply trunk at most 900 fpm at design"),
        ],
        "m/s",
        2
      ),
    },
    branch_rigid: {
      design: figure(
        [
          val(O("acca_manD_ahri", "branch_velocity", is("rigid", 3.05)), "a rigid supply branch, recommended 600 fpm"),
          val(O("ashrae1972_amca", "branch_velocity"), "residences' branch ducts 600 fpm"),
          val(O("airah_sw022", "branch_velocity", (x) => x.duct === "rigid"), "a duct carrying under 180 L/s, sized at 4.5 m/s"),
        ],
        "m/s",
        2
      ),
      most: figure(
        [
          val(O("acca_manD_ahri", "branch_velocity", is("rigid", 4.57)), "a rigid supply branch, maximum 900 fpm"),
          val(O("carrier_cz2", "branch_velocity"), "sheet-metal branch ducts at most 700 fpm"),
          val(O("actron_0520_026", "branch_velocity", (x) => /RUNOUT/.test(String(x.notes))), "the final duct to an outlet at most 3 m/s"),
        ],
        "m/s",
        2
      ),
    },
    branch_flex: {
      design: figure([val(O("acca_manD_ahri", "branch_velocity", is("flex", 3.05)), "a flex supply branch, recommended 600 fpm")], "m/s", 2),
      most: figure(
        [
          val(O("acca_manD_ahri", "branch_velocity", is("flex", 3.56)), "a flex supply branch, maximum 700 fpm"),
          val(O("airah_sw022", "branch_velocity", (x) => x.duct === "flex"), "long flex runouts limited to 3.5 m/s"),
          val(O("actron_0520_026", "branch_velocity", (x) => /RUNOUT/.test(String(x.notes))), "the final duct to an outlet at most 3 m/s"),
          val(O("natspec_0741", "main_velocity", (x) => x.duct === "flex"), "flexible duct at most 4 m/s"),
        ],
        "m/s",
        2
      ),
    },
  };
  const actronBranch = O("actron_0520_026", "branch_velocity", (x) => !/RUNOUT/.test(String(x.notes)));

  /* friction: what designers size at, the code's cap apart */
  const friction = figure(
    [
      val(O("airah_sw022", "friction_rate"), "Ahern's rule for 180–4500 L/s"),
      val(O("airah_ncc2025_resp", "friction_rate"), "the most designers were taught"),
      val(O("acca_manD_ahri", "friction_rate", (x) => /design/i.test(String(x.notes))), "its worked example's design friction, 0.10 in.wc/100 ft"),
      val(O("smacna_dd4", "friction_rate"), "commonly 0.8–1.0 Pa/m, the middle"),
      val(O("carrier_cz2", "friction_rate"), "supply design 0.1 in.wc/100 ft"),
      val(O("honeywell_zoning", "friction_rate"), "typically 0.08–0.10 in.wc/100 ft, the middle"),
      val(O("southwark_ductschool", "friction_rate"), "its size table's basis"),
    ],
    "Pa/m",
    2
  );
  const cap = figure([val(O("ncc2022_j6d5", "friction_rate"), "the most an index run averages, Class 2–9 buildings"), val(O("natspec_0741", "friction_rate"), "rigid ductwork at most 1 Pa/m")], "Pa/m", 2);

  /* rigid round duct, L/s by diameter: the tables published at about the
     design friction, each read between its own sizes */
  const rigidSources = [
    { source: "carrier_cz2", basis: "its pipe capacity at 0.1 in.wc/100 ft" },
    { source: "southwark_ductschool", basis: "its size table at 0.09–0.10 in.wc/100 ft (it reads high)" },
    { source: "smacna_dd4", basis: "its worked example at about 0.9 Pa/m" },
  ].map((s) => ({ ...s, points: M(s.source, "round_duct_ls").map((x) => ({ x: valueOf(x, "dia_mm"), y: valueOf(x) })) }));
  /* a big duct at that friction runs faster than any main is recommended
     to: the recommendation is the lower of its friction and the rigid
     main's design velocity */
  const vDesign = velocity.main_rigid.design.value;
  const vMost = velocity.main_rigid.most.value;
  const rigid: RigidRow[] = [150, 200, 250, 300, 350, 400, 450].flatMap((d) => {
    const got = rigidSources.flatMap((s) => {
      const q = logInterp(s.points, d);
      return q == null ? [] : [{ source: canon("mains", s.source), value: q, basis: s.points.some((p) => p.x === d) ? s.basis : `${s.basis}, log-interpolated to ${d} mm` }];
    });
    if (!got.length) return [];
    const f = figure(got, "L/s", 0);
    const byVelocity = round(vDesign * roundArea(d) * 1000, 0);
    const recommended = Math.min(f.value, byVelocity);
    return [
      {
        dia_mm: d,
        recommended_ls: recommended,
        velocity_ms: round(recommended / 1000 / roundArea(d), 2),
        limited_by: recommended < f.value ? ("velocity" as const) : ("friction" as const),
        most_ls: Math.max(recommended, round(vMost * roundArea(d) * 1000, 0)),
        at_design_friction_ls: f.value,
        low_ls: f.low,
        high_ls: f.high,
        n: f.n,
        from: f.from,
      },
    ];
  });

  /* ── what eats the unit's static: the design allowance, and the code's most ── */
  const esp = figure(
    [
      val(O("actron_0520_026", "esp_total"), "the ideal for a variable-airflow system"),
      val(O("nrcan_zoning", "esp_total"), "low-velocity duct, at most 0.5 in.wc"),
      val(O("zonefirst_guide", "esp_total"), "a blower's usual rating, 0.5 in.wc"),
      val(O("brivis_sp", "esp_total"), "its heaters rated at it"),
      val(O("acca_manD_ahri", "esp_total"), "its worked example's external static"),
    ],
    "Pa",
    0
  );
  const espMost = figure([val(O("actron_db0817", "esp_total"), "at commissioning, the total external static never over it")], "Pa", 0);
  const zr = O("acca_zr_draft", "damper_drop", (x) => x.unit === "%");
  const nccDamper = valueOf(O("ncc2022_j6d5", "damper_drop"));
  const tz = M("temperzone_flex", "diffuser_drop", (x) => !/kinked/.test(String(x.notes)));
  const drops = {
    zone_damper_open: {
      ...figure([val(zr, `an open modulating zone damper about ${valueOf(zr)}% of the path's drop, of the guide's ${esp.value} Pa (derived)`, (valueOf(zr) / 100) * esp.value)], "Pa", 1),
      most: nccDamper,
      most_from: "ncc-2022-j6d5",
    },
    balancing_damper_open: { ...figure([val(O("acca_manD_ahri", "damper_drop"), "the standard 0.03 in.wc for a balancing damper")], "Pa", 1), most: nccDamper, most_from: "ncc-2022-j6d5" },
    diffuser_and_boot: {
      ...figure(
        [
          val(O("acca_manD_ahri", "diffuser_drop"), "the standard 0.03 in.wc for a supply outlet"),
          ...tz.map((x) => val(x, /Side/.test(String(x.notes)) ? "a side-entry diffuser box, measured at 4.5 m/s" : "a top-entry diffuser on supported flex, measured at 4.5 m/s")),
          ...M("smacna_dd4", "diffuser_drop").map((x) => val(x, /440/.test(String(x.notes)) ? "a 10 in. diffuser at its rated 208 L/s" : "a 400x250 mm grille, its worked example")),
          val(O("airah_sw022", "diffuser_drop"), "a cushion-head box, 1.5 velocity heads at 4 m/s"),
        ],
        "Pa",
        1
      ),
      most: valueOf(O("ncc2022_j6d5", "diffuser_drop")),
      most_from: "ncc-2022-j6d5",
    },
    filter_clean: { ...cleanFilterDrop(ev), about: "The return's clean filter: the same figure as return_air.json." },
    eggcrate_return_grille: figure(
      [
        ...pick(ev, "return", "acca_manual_d", "return_grille_face_velocity", (x) => num(x.pressure_pa) != null).map((x) => from("return", x, valueOf(x, "pressure_pa"), "its worked example's return grille, 0.03 in.wc")),
        ...pick(ev, "return", "airfoil_hr5f", "return_grille_face_velocity").map((x) => from("return", x, valueOf(x, "pressure_pa"), `its hinged eggcrate at ${String(x.velocity_ms)} m/s on the neck`)),
        ...pick(ev, "return", "price_80", "return_grille_size_ls", (x) => x.velocity_ms === 2.54).map((x) => from("return", x, valueOf(x, "pressure_pa"), `its 80 eggcrate ${String(x.size)} at 2.54 m/s on the core`)),
      ],
      "Pa",
      1
    ),
  };

  /* a 90° flex bend: Temperzone's measured drop over the velocity head it
     was measured at (Pv = 0.6 v², AIRAH SW022) */
  const bend = (r: RegExp) => {
    const x = O("temperzone_flex", "flex_per_m", (y) => y.unit === "Pa" && r.test(String(y.notes)));
    const vAt = Number(must(/at ([\d.]+) m\/s/.exec(String(x.notes))?.[1], "the bend's velocity"));
    return figure([val(x, `${valueOf(x)} Pa at ${vAt} m/s ÷ its velocity head of ${round(0.6 * vAt ** 2, 2)} Pa`, valueOf(x) / (0.6 * vAt ** 2))], "velocity heads", 2);
  };

  return {
    about:
      "Mains, branches and the static the duct run has to fit in. A branch is the run to the outlets (ACCA's and ASHRAE's sense); ActronAir's 4–6 m/s branch sits between its main and that final run. Each publisher's own figure; design and most kept apart.",
    velocity_ms: { ...velocity, actronair_intermediate_branch: { value: valueOf(actronBranch), unit: "m/s", sources: ["actronair-0520-026"], about: "Between the main and the final run to the outlets, recommended 4–6 m/s." } },
    friction_pa_m: { design: friction, cap: { ...cap, about: "The NCC's most for an index run's average (Class 2–9 buildings, not houses), flex counted as laid straight." } },
    rigid_round_ls: {
      about:
        "Round sheet-metal duct, L/s by diameter. at_design_friction_ls is the median of the tables published at about the design friction; recommended_ls is that or the rigid main's design velocity × the area, whichever is lower (limited_by says which), most_ls the rigid main's most velocity × the area.",
      rows: rigid,
    },
    external_static_pa: { design: esp, most: espMost },
    drops_pa: drops,
    flex_bend_90: { r_1_5d: bend(/R = 1\.5D/), r_0_5d: bend(/R = 0\.5D/), velocity_head: "Pv = 0.6 v² Pa" },
    flex_rules: FLEX_RULES,
    takeoff_rules: TAKEOFF_RULES,
  };
}

/** The flex and takeoff rules, as their sources put them. A test holds each
    number to its first source's own words in the evidence. */
export const FLEX_RULES: readonly { rule: string; value: number; unit: string; sources: string[] }[] = [
  { rule: "No more than 6 m of flex in any duct run.", value: 6, unit: "m", sources: ["ncc-2022-j6d5", "as4254-ccc", "natspec-0741"] },
  { rule: "Fully stretched, with no joints in a run: at 90% extension a flex loses about 3 times as much, at 70% about 10 times.", value: 90, unit: "% extension", sources: ["natspec-0741", "as4254-ccc", "lbnl-abushakra-2002"] },
  { rule: "No more than 5% excess length.", value: 5, unit: "%", sources: ["airah-sw023"] },
  { rule: "A bend's centreline radius at least 1 duct diameter; Temperzone asks 1.5.", value: 1, unit: "D", sources: ["airah-sw023", "temperzone-flex"] },
  { rule: "Straight at least 300 mm out of a plenum, junction or boot before any bend.", value: 300, unit: "mm", sources: ["airah-sw023"] },
  { rule: "Supported at most every 1.5 m.", value: 1.5, unit: "m", sources: ["airah-sw023", "actronair-db0817"] },
  { rule: "A flex run's friction taken at twice its measured length.", value: 2, unit: "× its length", sources: ["airah-sw022"] },
];
export const TAKEOFF_RULES: readonly { rule: string; value?: number; unit?: string; sources: string[] }[] = [
  { rule: "Never a duct smaller than the unit's spigot.", sources: ["temperzone-flex"] },
  { rule: "The outlets' total area at least the spigot's.", sources: ["temperzone-flex"] },
  { rule: "A run over 3 m stepped up one size.", value: 3, unit: "m", sources: ["temperzone-flex"] },
  { rule: "Straight at least 300 mm out of the plenum before a bend.", value: 300, unit: "mm", sources: ["airah-sw023"] },
  { rule: "A zone damper at least 0.9 m from the plenum and 1.8 m from any outlet.", value: 0.9, unit: "m", sources: ["honeywell-zoning"] },
  { rule: "Balanced at the takeoffs, not the outlets: less noise and less static.", sources: ["actronair-0520-026"] },
];

/* ════════════════════════ zoning ════════════════════════ */

function buildZoning(ev: Evidence) {
  const M = (source: string, item: string, where: (x: Row) => boolean = () => true) => pick(ev, "mains", source, item, where);
  const val = (x: Row) => from("mains", x, valueOf(x), String(x.notes));
  const minFan = figure(
    [
      ...M("actron_0520_026", "min_airflow_pct").map(val),
      ...M("actron_db0817", "min_airflow_pct").map(val),
      /* the furnace's row is a heating limit */
      ...M("lennox_h3", "min_airflow_pct", (x) => !/furnace/i.test(String(x.notes))).map(val),
    ],
    "% of the rated airflow",
    1
  );
  const fixed = figure([...M("carrier_cz2", "min_airflow_pct"), ...M("zonefirst_guide", "min_airflow_pct"), ...M("nrcan_zoning", "min_airflow_pct")].map(val), "% of the rated airflow", 0);
  const smallest = figure(M("honeywell_zoning", "min_airflow_pct").map(val), "% of the rated airflow", 0);
  const outlets = figure(
    [
      ...M("actron_0520_026", "min_outlets_per_zone").map(val),
      /* with its fan slowing (adaptive zoning); its fixed-fan figure is heating's */
      ...M("brivis_sp", "min_outlets_per_zone", (x) => !/Heating-only/.test(String(x.notes))).map(val),
      ...M("aussieair_myair4", "min_outlets_per_zone").map(val),
    ],
    "outlets",
    0
  );
  return {
    about: "Zoned ducted systems: how little air a unit can move, what has to stay open for it, and what to do when too little can.",
    min_fan_airflow_pct: { ...minFan, about: "An inverter (variable-airflow) unit's least airflow, a share of its rated: for when its own low fan isn't known." },
    fixed_speed_open_pct: { ...fixed, about: "A fan that can't slow: the zones left open on their own must carry this share of its airflow, or it needs a bypass." },
    smallest_zone_pct: { ...smallest, about: "No zone smaller than about this share of the airflow." },
    min_open_outlets: { ...outlets, about: "The fewest outlets open at once: the smallest zone that runs on its own, with any zone that stays open." },
    constant_zones: {
      least: valueOf(M("polyaire_at5", "spill_rule")[0]!),
      most: valueOf(M("aa_myair5", "spill_rule")[0]!),
      most_share_of_zones: 0.5,
      never: "a bedroom",
      sources: ["polyaire-at5", "aa-myair5", "polyaire-at4", "aa-zs2", "me-paczc", "reece-myzone"],
      about: "A zone that stays open whenever the unit runs (common, constant or spill): at least one unless another zone is always open, one to three by the system's size, no more than half the zones, never a bedroom.",
    },
    spill_rule: {
      rule: "The zones that can be left open on their own must pass the unit's least airflow, through outlets sized for it. Where they can't: a common zone that's always open, then spill zones that open as others close, and a bypass last. A bypass costs capacity and efficiency, and some codes don't allow one.",
      sources: ["actronair-db0817", "polyaire-at4", "polyaire-zm2014", "me-paczc", "daikin-fdyqn", "nrcan-zoning", "ca-title24", "proctor-h114", "honeywell-zoning", "ewc-bypass", "carrier-cz2"],
    },
  };
}

/* ════════════════════════ sources ════════════════════════ */

export type GuideSource = {
  id: string;
  publisher: string;
  publisher_group: string;
  title: string;
  year: number | null;
  page: string;
  url: string;
  region: string;
  confidence: string;
  /* one document read for several topics: each read's own words for it */
  titles?: string[];
  urls?: string[];
  pages?: string[];
  evidence: string[];
  used_in: string[];
  not_averaged?: string;
};

function buildSources(ev: Evidence, used: Map<string, Set<string>>) {
  const byId = new Map<string, Omit<GuideSource, "publisher_group" | "used_in">>();
  for (const file of ["flex", "outlets", "return", "mains"] as const)
    for (const s of ev[file].sources) {
      if (s.status === "rejected") continue;
      const id = canon(file, s.id);
      const ref = `${EVIDENCE_FILES[file]}#${s.id}`;
      const was = byId.get(id);
      if (!was) {
        byId.set(id, { id, publisher: s.publisher, title: s.title, year: s.year ?? null, page: s.page ?? "", url: s.url, region: s.region, confidence: s.confidence, evidence: [ref] });
        continue;
      }
      was.evidence.push(ref);
      if (s.title !== was.title) was.titles = [...new Set([...(was.titles ?? [was.title]), s.title])];
      if (s.url !== was.url) was.urls = [...new Set([...(was.urls ?? [was.url]), s.url])];
      if (s.page && s.page !== was.page) was.pages = [...new Set([...(was.pages ?? [was.page]), s.page])];
    }
  const sources: GuideSource[] = [...byId.values()]
    .map((s) => ({ ...s, publisher_group: PUBLISHER[s.id] ?? s.publisher, used_in: [...(used.get(s.id) ?? [])].sort(), ...(NOT_AVERAGED[s.id] ? { not_averaged: NOT_AVERAGED[s.id] } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const id of used.keys()) if (!byId.has(id)) throw new Error(`A figure cites ${id}, which no evidence file lists`);
  const rejected = [
    ...ev.flex.sources.filter((s) => s.status === "rejected").map((s) => ({ source: s.publisher, title: s.title, url: s.url, reason: s.notes ?? "" })),
    ...ev.outlets.rejected.map((s) => ({ source: s, reason: "Read and left out by the outlet research." })),
    ...ev.return.rejected.map((s) => ({ source: s.source, reason: s.reason })),
    ...ev.mains.values.filter((x) => /REJECTED|not residential/.test(String(x.notes))).map((x) => ({ source: canon("mains", String(x.source)), figure: `${String(x.item)} ${String(x.value)} ${String(x.unit)}`, reason: String(x.notes) })),
  ];
  return { about: "Every source the guide read, one entry a document, what it was used in, and `evidence`: where its rows are in evidence/.", sources, rejected };
}

/* ════════════════════════ the whole ════════════════════════ */

export const GUIDE_FILES = ["flex_duct.json", "supply_outlets.json", "return_air.json", "ducts.json", "zoning.json", "sources.json"] as const;

export type FlexDuct = ReturnType<typeof buildFlex>;
export type SupplyOutlets = ReturnType<typeof buildOutlets>;
export type ReturnAir = ReturnType<typeof buildReturn>;
export type Ducts = ReturnType<typeof buildDucts>;
export type Zoning = ReturnType<typeof buildZoning>;

/** Every generated table, by its file name: the same evidence gives the same bytes. */
export function buildAirflowGuide(ev: Evidence) {
  const tables = { "flex_duct.json": buildFlex(ev), "supply_outlets.json": buildOutlets(ev), "return_air.json": buildReturn(ev), "ducts.json": buildDucts(ev), "zoning.json": buildZoning(ev) };
  /* what each source is used in, read off the figures themselves */
  const used = new Map<string, Set<string>>();
  const note = (id: string, file: string) => used.set(id, (used.get(id) ?? new Set()).add(file));
  const walk = (file: string, x: unknown): void => {
    if (Array.isArray(x)) return x.forEach((y) => walk(file, y));
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    for (const k of ["source", "most_from"]) if (typeof o[k] === "string") note(o[k] as string, file);
    if (Array.isArray(o.sources)) for (const s of o.sources) if (typeof s === "string") note(s, file);
    Object.values(o).forEach((y) => walk(file, y));
  };
  for (const [file, t] of Object.entries(tables)) walk(file, t);
  return { ...tables, "sources.json": buildSources(ev, used) };
}

/** JSON a person can read and a diff can follow: whatever fits on a line
    stays on one (a table's row), the rest opens up. */
export function formatGuideJson(value: unknown): string {
  const out = (x: unknown, indent: string, keyLen: number): string => {
    const flat = JSON.stringify(x);
    if (x === null || typeof x !== "object" || indent.length + keyLen + flat.length <= 140) return flat;
    const next = `${indent}  `;
    if (Array.isArray(x)) return x.length === 0 ? "[]" : `[\n${x.map((e) => next + out(e, next, 0)).join(",\n")}\n${indent}]`;
    const entries = Object.entries(x as Record<string, unknown>).filter(([, e]) => e !== undefined);
    return `{\n${entries.map(([k, e]) => `${next}${JSON.stringify(k)}: ${out(e, next, k.length + 4)}`).join(",\n")}\n${indent}}`;
  };
  return `${out(value, "", 0)}\n`;
}
