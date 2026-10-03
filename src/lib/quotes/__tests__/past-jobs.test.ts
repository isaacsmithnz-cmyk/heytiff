/* The quote builder held to Diamond Air's own quotes: 39 wall splits and 4
   ducted systems out of ServiceM8, each rebuilt from its facts and the price
   book as it stood, then compared with what was actually quoted.

   The numbers below are ratchets: a change to the rules may tighten them,
   never loosen them. PAST_JOBS_REPORT=1 prints the job-by-job table. */
import { DEFAULT_BUILD_SETTINGS, priceBuildUp, type BuildSettings } from "../buildup";
import { ductedLines, type PriceOf } from "../ducted-template";
import { splitLines } from "../split-template";
import { PAST_JOBS, type PastJob } from "./fixtures/past-jobs";
import { PAST_JOBS_BOOK } from "./fixtures/past-jobs-book";

const priceOf: PriceOf = (code) => {
  const b = PAST_JOBS_BOOK[code];
  return b ? { supplierKey: b[0], buyCents: b[1], name: b[2] } : null;
};

type Row = {
  job: string;
  kind: string;
  era: string;
  missing: string[];
  days: [ours: number, his: number];
  unitsBuy: [ours: number, his: number | null];
  sell: [ours: number, his: number | null];
};

function bench(j: PastJob, s: BuildSettings = DEFAULT_BUILD_SETTINGS): Row {
  const built = j.kind === "split" ? splitLines(j.facts, priceOf) : ductedLines(j.facts, priceOf);
  /* labour is never the builder's guess (Isaac, 2026-10-04): each job is
     priced with the person-days it was actually quoted at, so what is held
     here is the parts and the margins */
  const visits = [{ stage: "Install" as const, people: 1, days: j.quoted.personDays }];
  const b = priceBuildUp(built.lines, visits, s);
  const unitsBuy = b.groups.find((g) => g.name === "Units")?.buyCents ?? 0;
  const q = j.quoted;
  const his =
    q.totalCents ??
    (q.unitsCents != null && q.materialsCents != null && q.labourCents != null ? q.unitsCents + q.materialsCents + q.labourCents : null);
  /* the contingency is a margin Isaac asked for on top of what he used to
     quote, so the like-for-like comparison leaves it out */
  const contingency = (b.contingency?.sellCents ?? 0) + Math.round((b.contingency?.hours ?? 0) * s.labourRateCents);
  return {
    job: j.job,
    kind: j.kind,
    era: j.era,
    missing: built.missing,
    days: [b.labour.personDays, q.personDays],
    unitsBuy: [unitsBuy, q.unitsCostCents ?? null],
    sell: [b.exGstCents - contingency, j.era === "now" ? his : null],
  };
}

const pct = (ours: number, his: number) => ((ours - his) / his) * 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const rows = PAST_JOBS.map((j) => bench(j));
const priced = rows.filter((r) => r.sell[1] != null);
const costed = rows.filter((r) => r.unitsBuy[1] != null);

if (process.env.PAST_JOBS_REPORT) {
  const $ = (c: number | null) => (c == null ? "" : `$${(c / 100).toFixed(0)}`);
  const lines = rows.map((r) =>
    [
      r.job.padEnd(5),
      r.kind.padEnd(7),
      r.era.padEnd(4),
      `${r.days[0]}/${r.days[1]}`.padEnd(8),
      `${$(r.unitsBuy[0])}/${$(r.unitsBuy[1])}`.padEnd(14),
      r.sell[1] != null ? `${$(r.sell[0])} vs ${$(r.sell[1])} ${pct(r.sell[0], r.sell[1]).toFixed(1)}%` : "",
      r.missing.length ? `missing ${r.missing.join(",")}` : "",
    ].join(" ")
  );
  console.log(["job   kind    era  days     units buy      sell (ours vs his)", ...lines].join("\n"));
}

describe("the quote builder against Diamond Air's own quotes", () => {
  it("builds every past job from the price book with nothing missing", () => {
    expect(rows.filter((r) => r.missing.length).map((r) => [r.job, r.missing])).toEqual([]);
  });


  it("buys the units for what they cost", () => {
    const gaps = costed.map((r) => Math.abs(pct(r.unitsBuy[0], r.unitsBuy[1]!)));
    expect(costed.length).toBe(23);
    expect(median(gaps)).toBeLessThanOrEqual(6);
  });

  it("prices within a few percent of what was quoted", () => {
    const gaps = priced.map((r) => Math.abs(pct(r.sell[0], r.sell[1]!)));
    expect(priced.length).toBe(23);
    expect(median(gaps)).toBeLessThanOrEqual(3.5);
    expect(gaps.filter((g) => g <= 5).length).toBeGreaterThanOrEqual(20);
    /* and leans neither way */
    const mean = priced.reduce((a, r) => a + pct(r.sell[0], r.sell[1]!), 0) / priced.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(1.5);
  });
});
