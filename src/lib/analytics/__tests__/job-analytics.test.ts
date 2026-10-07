/* Job analytics: which jobs are quotes, the 180-day rule, the periods, and
   the figures the page draws, on jobs shaped as the mirror hands them over. */
import {
  analyse,
  change,
  LAPSE_AFTER_DAYS,
  money,
  outcomeOf,
  pct,
  periodSpan,
  spanBefore,
  yearEarlier,
  type AnalyticsJob,
} from "../job-analytics";

const TODAY = "2026-10-07";

let n = 0;
const job = (over: Partial<AnalyticsJob>): AnalyticsJob => ({
  id: `j${++n}`,
  status: "Quote",
  raisedOn: "2026-09-01",
  quoteSentOn: null,
  wonOn: null,
  completedOn: null,
  valueCents: 500_000,
  kind: "split",
  ...over,
});

describe("which jobs are quotes, and where each stands", () => {
  it("leaves out a work order nobody quoted", () => {
    expect(outcomeOf(job({ status: "Work Order", quoteSentOn: null }), TODAY)).toBeNull();
    expect(outcomeOf(job({ status: "Completed", quoteSentOn: null }), TODAY)).toBeNull();
  });

  it("counts a work order a quote went out for as won", () => {
    expect(outcomeOf(job({ status: "Work Order", quoteSentOn: "2026-09-02" }), TODAY)).toBe("won");
    expect(outcomeOf(job({ status: "Completed", quoteSentOn: "2026-09-02" }), TODAY)).toBe("won");
  });

  it("counts Unsuccessful as lost, sent or not", () => {
    expect(outcomeOf(job({ status: "Unsuccessful" }), TODAY)).toBe("lost");
    expect(outcomeOf(job({ status: "Unsuccessful", quoteSentOn: "2026-09-02" }), TODAY)).toBe("lost");
  });

  it("counts a Quote as lost once it is more than 180 days old, and not a day before", () => {
    const raised = (days: number) => {
      const d = new Date(`${TODAY}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };
    expect(outcomeOf(job({ raisedOn: raised(LAPSE_AFTER_DAYS) }), TODAY)).toBe("open");
    expect(outcomeOf(job({ raisedOn: raised(LAPSE_AFTER_DAYS + 1) }), TODAY)).toBe("lapsed");
  });

  it("counts a quote won after the 180 days as won: the rule is read, never stored", () => {
    expect(outcomeOf(job({ status: "Work Order", raisedOn: "2026-01-02", quoteSentOn: "2026-01-05", wonOn: "2026-08-01" }), TODAY)).toBe("won");
  });

  it("reads ServiceM8's status whatever its case or spacing", () => {
    expect(outcomeOf(job({ status: " work order ", quoteSentOn: "2026-09-02" }), TODAY)).toBe("won");
    expect(outcomeOf(job({ status: "UNSUCCESSFUL" }), TODAY)).toBe("lost");
  });
});

describe("the periods", () => {
  it("runs 12 months to today, from the day after a year ago", () => {
    expect(periodSpan("12m", TODAY)).toEqual({ from: "2025-10-08", to: TODAY });
  });

  it("starts the financial year on 1 July, either side of it", () => {
    expect(periodSpan("fy", TODAY)).toEqual({ from: "2026-07-01", to: TODAY });
    expect(periodSpan("fy", "2026-03-15")).toEqual({ from: "2025-07-01", to: "2026-03-15" });
    expect(periodSpan("fy", "2026-07-01")).toEqual({ from: "2026-07-01", to: "2026-07-01" });
  });

  it("takes the calendar quarter so far", () => {
    expect(periodSpan("quarter", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(periodSpan("quarter", "2026-02-11")).toEqual({ from: "2026-01-01", to: "2026-02-11" });
    expect(periodSpan("quarter", "2026-06-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("compares with the same days a year earlier, 29 February included", () => {
    expect(spanBefore({ from: "2025-10-08", to: TODAY })).toEqual({ from: "2024-10-08", to: "2025-10-07" });
    expect(yearEarlier("2028-02-29")).toBe("2027-02-28");
  });
});

describe("the figures", () => {
  const jobs: AnalyticsJob[] = [
    // this period: 3 won, 1 Unsuccessful, 1 lapsed, 1 open, 1 work order nobody quoted
    job({ status: "Work Order", raisedOn: "2026-08-01", quoteSentOn: "2026-08-02", wonOn: "2026-08-10", valueCents: 400_000, kind: "split" }),
    job({ status: "Completed", raisedOn: "2026-06-01", quoteSentOn: "2026-06-05", wonOn: "2026-06-25", completedOn: "2026-07-10", valueCents: 1_200_000, kind: "ducted" }),
    job({ status: "Work Order", raisedOn: "2025-11-01", quoteSentOn: "2025-11-20", wonOn: "2026-06-01", valueCents: 600_000, kind: null }),
    job({ status: "Unsuccessful", raisedOn: "2026-05-01", quoteSentOn: "2026-05-01", valueCents: 800_000, kind: "split" }),
    job({ status: "Quote", raisedOn: "2026-01-10", quoteSentOn: "2026-01-12", valueCents: 300_000, kind: "multi" }),
    job({ status: "Quote", raisedOn: "2026-09-20", valueCents: null, kind: "split" }),
    job({ status: "Completed", raisedOn: "2026-08-15", quoteSentOn: null, completedOn: "2026-08-16", valueCents: 50_000, kind: "service" }),
    // the year before: 1 won, 1 lost
    job({ status: "Completed", raisedOn: "2025-03-01", quoteSentOn: "2025-03-08", wonOn: "2025-03-20", completedOn: "2025-04-01", valueCents: 500_000, kind: "split" }),
    job({ status: "Unsuccessful", raisedOn: "2025-02-01", quoteSentOn: "2025-02-03", valueCents: 700_000, kind: "split" }),
  ];
  const a = analyse(jobs, TODAY, "12m");

  it("rates won against decided quotes, the lapsed counted lost", () => {
    expect(a.top.winRate).toEqual({ won: 3, decided: 5, rate: 0.6 });
    expect(a.top.winRateBefore).toEqual({ won: 1, decided: 2, rate: 0.5 });
    expect(a.top.quotes).toBe(6);
    expect(a.top.open).toBe(1);
  });

  it("rates by value too", () => {
    // won 22,000 of decided 22,000 + 8,000 + 3,000
    expect(a.top.valueRate).toBeCloseTo(2_200_000 / 3_300_000);
  });

  it("adds up quoted, won and completed work, and the year before", () => {
    expect(a.top.quotedCents).toBe(400_000 + 1_200_000 + 600_000 + 800_000 + 300_000);
    expect(a.top.wonCents).toBe(2_200_000);
    expect(a.top.wonBefore).toBe(500_000);
    // completed in the span: the ducted job and the unquoted service call
    expect(a.top.completedCents).toBe(1_250_000);
    expect(a.top.completedBefore).toBe(500_000);
  });

  it("takes the middle of the won jobs, and the days to quote", () => {
    expect(a.top.medianWonCents).toBe(600_000);
    expect(a.top.averageWonCents).toBeCloseTo(2_200_000 / 3);
    // 1, 4, 19, 0, 2 days from raised to sent
    expect(a.top.speedDays).toBe(2);
  });

  it("breaks the win rate down by kind, with the unknown kept apart", () => {
    expect(a.byKind.map((b) => [b.label, b.won, b.decided])).toEqual([
      ["Wall split", 1, 2],
      ["Multi-split", 0, 1],
      ["Ducted", 1, 1],
      ["Not known", 1, 1],
    ]);
  });

  it("breaks it down by price and by speed to quote", () => {
    expect(a.byPrice.map((b) => [b.key, b.won, b.decided])).toEqual([
      ["lt5", 1, 2],
      ["lt10", 1, 2],
      ["lt20", 1, 1],
    ]);
    expect(a.bySpeed.map((b) => [b.key, b.won, b.decided])).toEqual([
      ["d1", 1, 2],
      ["d3", 0, 1],
      ["d7", 1, 1],
      ["slow", 1, 1],
    ]);
  });

  it("counts the days to a yes, and a win after 180 days in the last column", () => {
    const counts = Object.fromEntries(a.quotes.daysToYes.map((b) => [b.label, b.count]));
    expect(counts["8–14"]).toBe(1);
    expect(counts["15–30"]).toBe(1);
    expect(counts["Over 180"]).toBe(1);
    expect(a.quotes.lateWins).toBe(1);
    expect(a.quotes.winsDated).toBe(3);
  });

  it("splits the lost into Unsuccessful and past 180 days", () => {
    expect(a.quotes.unsuccessful).toEqual({ count: 1, cents: 800_000 });
    expect(a.quotes.lapsed).toEqual({ count: 1, cents: 300_000 });
  });

  it("groups today's open quotes as the board does", () => {
    const open = analyse(
      [
        job({ raisedOn: "2026-10-01", valueCents: null }),
        job({ raisedOn: "2026-09-01", valueCents: 100_000 }),
        job({ raisedOn: "2026-06-01", valueCents: 200_000 }),
        job({ raisedOn: "2026-04-20", valueCents: 300_000 }),
        job({ raisedOn: "2026-01-01", valueCents: 400_000 }),
      ],
      TODAY,
      "12m",
    ).quotes.openNow;
    expect(open.toPrice).toBe(1);
    expect(open.waiting).toEqual({ count: 1, cents: 100_000 });
    expect(open.cold).toEqual({ count: 2, cents: 500_000 });
    // 20 April is 170 days back: it reaches 180 inside the next 30
    expect(open.lapsingSoon).toEqual({ count: 1, cents: 300_000 });
  });

  it("prices won jobs by kind", () => {
    expect(a.prices.map((p) => [p.label, p.jobs, p.median])).toEqual([
      ["Wall split", 1, 400_000],
      ["Ducted", 1, 1_200_000],
      ["Not known", 1, 600_000],
    ]);
  });

  it("counts every job raised, quote or not, in whole weeks back from today", () => {
    expect(a.enquiries.total).toBe(7);
    expect(a.enquiries.totalBefore).toBe(2);
    // 365 days: 52 whole weeks ending today, the one day before them left off the line
    expect(a.enquiries.weeks).toHaveLength(52);
    expect(a.enquiries.weeks[51]!.start).toBe("2026-10-01");
    expect(a.enquiries.weeks[0]!.start).toBe("2025-10-09");
    expect(a.enquiries.weeks.reduce((s, w) => s + w.now, 0)).toBe(7);
    expect(a.enquiries.weeks.reduce((s, w) => s + w.before, 0)).toBe(2);
  });

  it("draws a period shorter than a week as one week", () => {
    const short = analyse([job({ raisedOn: "2026-10-02" })], "2026-10-03", "quarter");
    expect(short.enquiries.weeks).toEqual([{ start: "2026-09-27", now: 1, before: 0 }]);
    expect(short.enquiries.total).toBe(1);
  });
});

describe("the words", () => {
  it("says money the way a figure reads", () => {
    expect(money(465_000)).toBe("$4,650");
    expect(money(61_230_000)).toBe("$612k");
    expect(money(186_000_000)).toBe("$1.86M");
    expect(money(null)).toBe("—");
  });

  it("says a rate and a change", () => {
    expect(pct(0.462)).toBe("46%");
    expect(pct(null)).toBe("—");
    expect(change(114, 100)).toEqual({ words: "+14%", up: true });
    expect(change(97, 100)).toEqual({ words: "−3%", up: false });
    expect(change(5, 0)).toBeNull();
  });
});
