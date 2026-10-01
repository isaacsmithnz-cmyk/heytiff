/* The quote builder held to quotes it never saw the lines of: 15 jobs quoted
   as one sum, rebuilt from the scope written in ServiceM8. Looser than
   past-jobs.test.ts on purpose — a scope leaves things out — but ratcheted
   the same way. BLIND_JOBS_REPORT=1 prints the table. */
import { priceBuildUp, type BuildLine, type Visit } from "../buildup";
import { ductedLines, ductedVisits, type PriceOf } from "../ducted-template";
import { multiLines, multiVisits } from "../multi-template";
import { splitLines, splitVisits } from "../split-template";
import { BLIND_JOBS, type BlindJob } from "./fixtures/blind-jobs";
import { BLIND_JOBS_BOOK } from "./fixtures/blind-jobs-book";

const priceOf: PriceOf = (code) => {
  const b = BLIND_JOBS_BOOK[code];
  return b ? { supplierKey: b[0], buyCents: b[1], name: b[2] } : null;
};

function build(j: BlindJob) {
  const lines: BuildLine[] = [];
  const visits: Visit[] = [];
  const missing: string[] = [];
  for (const s of j.systems) {
    const r = s.kind === "split" ? splitLines(s.facts, priceOf) : s.kind === "multi" ? multiLines(s.facts, priceOf) : ductedLines(s.facts, priceOf);
    lines.push(...r.lines.map((l) => ({ ...l, key: `${s.kind}-${l.key}-${lines.length}` })));
    missing.push(...r.missing);
    visits.push(...(s.kind === "split" ? splitVisits(s.facts) : s.kind === "multi" ? multiVisits(s.facts) : ductedVisits(s.facts)));
  }
  const b = priceBuildUp(lines, visits);
  return { b, missing, gap: ((b.exGstCents - j.quotedCents) / j.quotedCents) * 100 };
}

const rows = BLIND_JOBS.map((j) => ({ j, ...build(j) }));

if (process.env.BLIND_JOBS_REPORT) {
  console.log(
    rows
      .map(({ j, b, gap, missing }) =>
        [
          j.job.padEnd(5),
          j.status.padEnd(5),
          j.systems.map((s) => s.kind).join("+").padEnd(13),
          `${b.labour.personDays}${j.notedPersonDays != null ? `/${j.notedPersonDays}` : ""} pd`.padEnd(8),
          `$${(b.exGstCents / 100).toFixed(0)} vs $${(j.quotedCents / 100).toFixed(0)}`.padEnd(18),
          `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`.padEnd(7),
          missing.length ? `missing ${missing.join(",")}` : "",
        ].join(" ")
      )
      .join("\n")
  );
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

describe("the quote builder on quotes it never saw the lines of", () => {
  it("builds every one from the price book", () => {
    expect(rows.filter((r) => r.missing.length).map((r) => [r.j.job, r.missing])).toEqual([]);
    expect(rows.length).toBe(15);
  });

  it("matches the person-days Isaac's own notes give", () => {
    const noted = rows.filter((r) => r.j.notedPersonDays != null);
    /* 3256 was noted at 3 with its circuit to run; the rule says 2 */
    expect(noted.map((r) => [r.j.job, r.b.labour.personDays - r.j.notedPersonDays!])).toEqual([
      ["3256", -1],
      ["3249", 0],
      ["3210", 0],
    ]);
  });

  it("lands near the sum that was quoted", () => {
    const gaps = rows.map((r) => Math.abs(r.gap));
    expect(median(gaps)).toBeLessThanOrEqual(13);
    expect(gaps.filter((g) => g <= 5).length).toBeGreaterThanOrEqual(5);
  });
});
