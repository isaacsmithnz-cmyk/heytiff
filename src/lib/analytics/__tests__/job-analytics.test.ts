/* Job analytics: which jobs are quotes, the 180-day rule, the periods, and
   the figures the page draws, on jobs shaped as the mirror hands them over. */
import {
  analyse,
  analyticsKindOf,
  yesOn,
  wasQuoted,
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

  it("counts Unsuccessful as lost once a quote went out, its document made or a claim invoiced", () => {
    expect(outcomeOf(job({ status: "Unsuccessful", quoteSentOn: "2026-09-02" }), TODAY)).toBe("lost");
    expect(outcomeOf(job({ status: "Unsuccessful", quoteDocOn: "2026-09-02" }), TODAY)).toBe("lost");
    // never quoted: not a quote at all
    expect(outcomeOf(job({ status: "Unsuccessful" }), TODAY)).toBeNull();
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
    expect(outcomeOf(job({ status: "UNSUCCESSFUL", quoteSentOn: "2026-09-02" }), TODAY)).toBe("lost");
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

describe("what can't be placed is asked, and the answers count", () => {
  const asksOf = (a: ReturnType<typeof analyse>) => a.toDecide.asks.map((x) => [x.job.id, x.question, x.answer]);

  it("asks whether a work order with no quote sent was quoted, when it reads like an install or is big", () => {
    const ducted = job({ id: "wo-ducted", status: "Completed", quoteSentOn: null, kind: "ducted", valueCents: 1_800_000, raisedOn: "2026-08-01", wonOn: "2026-08-02" });
    const big = job({ id: "wo-big", status: "Work Order", quoteSentOn: null, kind: null, category: "Install", valueCents: 450_000, raisedOn: "2026-08-03" });
    const callout = job({ id: "wo-small", status: "Completed", quoteSentOn: null, kind: "service", valueCents: 25_000, raisedOn: "2026-08-04" });
    const before = analyse([ducted, big, callout], TODAY, "12m");
    expect(asksOf(before)).toEqual([
      ["wo-ducted", "quote", null],
      ["wo-big", "quote", null],
    ]);
    // until answered, neither is a quote: left out of the win rate, and counted as left out
    expect(before.top.winRate.decided).toBe(0);
    expect(before.toDecide.leftOut).toEqual({ jobs: 2, cents: 2_250_000 });

    const after = analyse([ducted, big, callout], TODAY, "12m", new Map([["wo-ducted", { quote: "quote" }], ["wo-big", { quote: "not_quote" }]]));
    expect(after.top.winRate).toEqual({ won: 1, decided: 1, rate: 1 });
    expect(after.toDecide.open).toBe(0);
    expect(after.toDecide.leftOut).toEqual({ jobs: 0, cents: 0 });
    // answered, they are still listed, with the answer, so it can be undone
    expect(asksOf(after)).toEqual([
      ["wo-ducted", "quote", "quote"],
      ["wo-big", "quote", "not_quote"],
    ]);
  });

  it("asks won or lost when ServiceM8 and the money or the proposal disagree, and leaves it out until then", () => {
    const paid = job({ id: "paid", status: "Unsuccessful", paid: true, quoteSentOn: "2026-05-02", raisedOn: "2026-05-01" });
    const accepted = job({ id: "accepted", status: "Quote", acceptedInHeyTiff: true, quoteSentOn: "2026-06-02", raisedOn: "2026-06-01" });
    const plain = job({ id: "plain", status: "Unsuccessful", quoteSentOn: "2026-05-02", raisedOn: "2026-05-01" });
    const jobs = [paid, accepted, plain];
    expect(asksOf(analyse(jobs, TODAY, "12m"))).toEqual([
      ["paid", "outcome", null],
      ["accepted", "outcome", null],
    ]);
    expect(analyse(jobs, TODAY, "12m").top.winRate).toEqual({ won: 0, decided: 1, rate: 0 });
    const answered = analyse(jobs, TODAY, "12m", new Map([["paid", { outcome: "won" }], ["accepted", { outcome: "lost" }]]));
    expect(answered.top.winRate).toEqual({ won: 1, decided: 3, rate: 1 / 3 });
  });

  it("asks the kind of a decided quote it can't read, and counts the answer as that kind", () => {
    const unknown = job({ id: "u", status: "Work Order", quoteSentOn: "2026-08-02", wonOn: "2026-08-09", raisedOn: "2026-08-01", kind: null });
    const open = job({ id: "o", status: "Quote", raisedOn: "2026-09-30", kind: null });
    expect(asksOf(analyse([unknown, open], TODAY, "12m"))).toEqual([["u", "kind", null]]);
    // an unknown kind still counts, under "Not known", so it is not left out
    expect(analyse([unknown, open], TODAY, "12m").toDecide.leftOut.jobs).toBe(0);
    const answered = analyse([unknown, open], TODAY, "12m", new Map([["u", { kind: "ducted" }]]));
    expect(answered.byKind.map((b) => b.label)).toEqual(["Ducted"]);
    expect(answered.prices.map((p) => p.label)).toEqual(["Ducted"]);
  });

  it("asks about a price far from its kind's, and leaves it out of the prices, not the wins, until it is counted", () => {
    const won = (id: string, cents: number) =>
      job({ id, status: "Completed", quoteSentOn: "2026-07-02", wonOn: "2026-07-05", raisedOn: "2026-07-01", kind: "split", valueCents: cents });
    const jobs = [won("a", 380_000), won("b", 400_000), won("c", 420_000), won("d", 390_000), won("e", 9_650_000), won("f", 8_500)];
    const a = analyse(jobs, TODAY, "12m");
    expect(asksOf(a)).toEqual([
      ["e", "price", null],
      ["f", "price", null],
    ]);
    const e = a.toDecide.asks.find((x) => x.job.id === "e")!;
    expect(e.median).toBe(395_000);
    expect(Math.round(e.times!)).toBe(24);
    expect(a.top.winRate.won).toBe(6);
    expect(a.prices[0]!.jobs).toBe(4);
    expect(a.toDecide.leftOut).toEqual({ jobs: 2, cents: 9_658_500 });

    const counted = analyse(jobs, TODAY, "12m", new Map([["e", { price: "count" }], ["f", { price: "leave_out" }]]));
    expect(counted.prices[0]!.jobs).toBe(5);
    expect(counted.toDecide.open).toBe(0);
  });

  it("doesn't ask about prices until a kind has five priced wins", () => {
    const won = (id: string, cents: number) =>
      job({ id, status: "Completed", quoteSentOn: "2026-07-02", raisedOn: "2026-07-01", kind: "vrf", valueCents: cents });
    expect(analyse([won("a", 3_000_000), won("b", 3_100_000), won("c", 3_200_000), won("d", 30_000_000)], TODAY, "12m").toDecide.asks).toEqual([]);
  });
});

describe("a void job is not a job", () => {
  const lost = job({ id: "spam", status: "Unsuccessful", quoteSentOn: "2026-05-02", raisedOn: "2026-05-01", valueCents: 900_000 });
  const won = job({ id: "won", status: "Completed", quoteSentOn: "2026-06-02", wonOn: "2026-06-09", completedOn: "2026-07-01", raisedOn: "2026-06-01", valueCents: 400_000 });
  const lapsedDup = job({ id: "dup", status: "Quote", quoteSentOn: "2026-01-12", raisedOn: "2026-01-10", valueCents: 300_000 });
  const testJob = job({ id: "test", status: "Completed", quoteSentOn: null, completedOn: "2026-08-02", raisedOn: "2026-08-01", valueCents: 100 });
  const jobs = [lost, won, lapsedDup, testJob];

  it("lists the lost quotes for review, newest first, the 180-day ones marked", () => {
    expect(analyse(jobs, TODAY, "12m").quotes.lostJobs.map((l) => [l.job.id, l.why])).toEqual([
      ["spam", "marked"],
      ["dup", "lapsed"],
    ]);
  });

  it("takes a void job out of every figure, enquiries and completed work included, and lists it apart", () => {
    const before = analyse(jobs, TODAY, "12m");
    expect(before.top.winRate).toEqual({ won: 1, decided: 3, rate: 1 / 3 });
    expect(before.enquiries.total).toBe(4);
    expect(before.top.completedCents).toBe(400_100);

    const voided = new Map([
      ["spam", { void: "void" }],
      ["dup", { void: "void" }],
      ["test", { void: "void" }],
    ]);
    const after = analyse(jobs, TODAY, "12m", voided);
    expect(after.top.winRate).toEqual({ won: 1, decided: 1, rate: 1 });
    expect(after.top.quotedCents).toBe(400_000);
    expect(after.quotes.lapsed.count).toBe(0);
    expect(after.quotes.lostJobs).toEqual([]);
    expect(after.enquiries.total).toBe(1);
    expect(after.top.completedCents).toBe(400_000);
    expect(after.voided.map((j) => j.id)).toEqual(["test", "spam", "dup"]);
  });

  it("asks nothing about a void job", () => {
    const outlier = job({ id: "paid", status: "Unsuccessful", paid: true, quoteSentOn: "2026-05-02", raisedOn: "2026-05-01" });
    expect(analyse([outlier], TODAY, "12m").toDecide.asks).toHaveLength(1);
    expect(analyse([outlier], TODAY, "12m", new Map([["paid", { void: "void" }]])).toDecide.asks).toEqual([]);
  });
});

describe("what the live account taught the rules", () => {
  it("counts a job ServiceM8 made a Quote a day or more before its work order as quoted, where no sent date was kept", () => {
    expect(wasQuoted(job({ status: "Completed", quoteSentOn: null, quotedOn: "2026-03-01", wonOn: "2026-03-09" }))).toBe(true);
    // made a Quote and a Work Order the same day: done and charged, not quoted
    expect(wasQuoted(job({ status: "Completed", quoteSentOn: null, quotedOn: "2026-03-01", wonOn: "2026-03-01" }))).toBe(false);
    expect(wasQuoted(job({ status: "Work Order", quoteSentOn: null, quotedOn: null, wonOn: "2026-03-01" }))).toBe(false);
  });

  it("asks about an install-like work order only from $3,000 ex GST, and never about a call-out", () => {
    const small = job({ id: "small", status: "Completed", quoteSentOn: null, kind: "ducted", valueCents: 120_000, raisedOn: "2026-08-01" });
    const callout = job({ id: "call", status: "Completed", quoteSentOn: null, kind: null, category: "Service Call", valueCents: 900_000, raisedOn: "2026-08-01" });
    expect(analyse([small, callout], TODAY, "12m").toDecide.asks).toEqual([]);
  });

  it("reads a service call as a service whatever its words mention, and a kind from the lines' names", () => {
    expect(analyticsKindOf("Ducted system not cooling", [], "Service Call")).toBe("service");
    expect(analyticsKindOf("Annual service", [], "Annual Maintenance ")).toBe("maintenance");
    expect(analyticsKindOf("As per quote", ["MITSUBISHI ELEC. HIGH WALL SPLIT 4.2KW", "HVAC Labour"], "Install")).toBe("split");
    expect(analyticsKindOf("Supply and Install Mitsubishi Electric 3.5kw HWS", [], "Install")).toBe("split");
    expect(analyticsKindOf("As per quote", ["As Per Quote"], "Install")).toBeNull();
  });

  it("takes the yes from the first claim when the proposal was updated after it, and counts a Quote with a claim as won", () => {
    // #2587: deposit invoiced 28 Aug, the proposal updated (a Quote again), a work order again 25 Sep
    const updated = job({ status: "Work Order", raisedOn: "2026-03-20", quoteSentOn: "2026-03-23", wonOn: "2026-09-25", claimedOn: "2026-08-28" });
    expect(yesOn(updated)).toBe("2026-08-28");
    expect(yesOn(job({ wonOn: "2026-05-01", claimedOn: "2026-06-01" }))).toBe("2026-05-01");
    expect(yesOn(job({ wonOn: null, claimedOn: null }))).toBeNull();
    // 161 days to the deposit, not 189 to the last work order, which would read as a late win
    expect(analyse([updated], TODAY, "12m").quotes.daysToYes.map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 1, 0]);

    // mid-update: a Quote again, a year old, with a deposit on it — won, never lapsed
    const midUpdate = job({ status: "Quote", raisedOn: "2025-10-20", quoteSentOn: "2025-10-21", claimedOn: "2026-01-10" });
    expect(outcomeOf(midUpdate, TODAY)).toBe("won");
  });

  it("asks won or lost of a job Unsuccessful in ServiceM8 with a claim invoiced on it", () => {
    const claimed = job({ id: "cl", status: "Unsuccessful", raisedOn: "2026-03-30", quoteSentOn: "2026-03-31", claimedOn: "2026-09-29" });
    expect(analyse([claimed], TODAY, "12m").toDecide.asks.map((a) => [a.job.id, a.question])).toEqual([["cl", "outcome"]]);
  });

  it("reads a job's type from the words the live account uses, and leaves what can't be told unknown", () => {
    const kind = (d: string, lines: string[] = [], cat: string | null = "Install") => analyticsKindOf(d, lines, cat);
    // wall splits
    expect(kind("Mits 2.5kw split to guest bed $2500 plus")).toBe("split");
    expect(kind("Supply and Install: 2 x Carrier splits")).toBe("split");
    expect(kind("Install Daikin Cora 6kw Change over")).toBe("split");
    expect(kind("Would like a quote for the install of two MHI Avanti Plus 2 kW and one MHI Bronte 6.3 KW.")).toBe("split");
    expect(kind("Fuji 3.5kw install", ["As Per Quote"])).toBe("split");
    // ducted
    expect(kind("Mitsubishi Electric 14kw 1Ph 3 Zones Downstairs")).toBe("ducted");
    expect(kind("Ac installation of mits elec 14kw GAA system client supplying unit and 240v zone box")).toBe("ducted");
    expect(kind("DAIKIN STANDARD DUCT 14KW R32 Included: FDYAN140AV1")).toBe("ducted");
    expect(kind("Supply and Install 6kw Daikin Bulk Head Unit")).toBe("ducted");
    // multi
    expect(kind("Mitsubishi 5.2kw to serve 2 x 3.5kw high walls")).toBe("multi");
    expect(kind("8kw Outdoor 7kw indoor 4.2kw indoor")).toBe("multi");
    expect(kind("4 x Bulkheads off an Outdoor")).toBe("multi");
    expect(kind("Replacement of upstairs beds high walls 80multi outdoor")).toBe("multi");
    // ventilation
    expect(kind("Supply and installation of 200mm silent series sub floor fan and associated ductwork")).toBe("ventilation");
    expect(kind("Fw: Fresh Air Supply / Lossnay System Quote")).toBe("ventilation");
    expect(kind("Underfloor ventallation")).toBe("ventilation");
    // not what they seem
    expect(kind("Fw: 14 Boundary Street, Bronte: Quote Notes: Downstairs (3 Units)")).toBeNull();
    expect(kind("split level apartment, looking for whole property solution")).toBeNull();
    expect(kind("BTO required to split air flow to new room - 10' and 12' Duct")).toBeNull();
    expect(kind("Disconnect split temporarily.")).toBeNull();
    expect(kind("Duct Work Re-configuration", ["JOINER METAL 250MM/10\" INCH"])).toBeNull();
    expect(kind("Carry out service and cut bigger grills", ["Daikin Fan Motor"])).toBeNull();
    expect(kind("FUJITSU COMP CASSETTE 5.0KW 1PH R32")).toBeNull();
    expect(kind("Mitsubishi 9kw and 3.5kw installation", ["As Per Quote"])).toBeNull();
    expect(kind("Install AC", ["As Per Quote"])).toBeNull();
    // the category still comes first
    expect(kind("Exhaust fan rattling", [], "Service Call")).toBe("service");
  });

  it("reads what an Unsuccessful job was: a quote lost, a work order called off, an enquiry never quoted, or a question", () => {
    const at = { raisedOn: "2026-05-01", valueCents: 0 };
    const lostQuote = job({ ...at, id: "lost", status: "Unsuccessful", quoteDocOn: "2026-05-02", valueCents: 600_000 });
    const calledOff = job({ ...at, id: "off", status: "Unsuccessful", wonOn: "2026-05-01", valueCents: 28_000 });
    const neverQuoted = job({ ...at, id: "enq", status: "Unsuccessful", valueCents: null });
    const smallUnsent = job({ ...at, id: "small", status: "Unsuccessful", valueCents: 95_000 });
    const bigUnsent = job({ ...at, id: "big", status: "Unsuccessful", valueCents: 20_800_000 });
    const acceptedThenOff = job({ ...at, id: "acc", status: "Unsuccessful", quoteSentOn: "2026-05-03", wonOn: "2026-06-01", valueCents: 2_238_000 });
    const a = analyse([lostQuote, calledOff, neverQuoted, smallUnsent, bigUnsent, acceptedThenOff], TODAY, "12m");
    expect(a.top.quotes).toBe(1);
    expect(a.quotes.lostJobs.map((l) => l.job.id)).toEqual(["lost"]);
    expect(a.toDecide.asks.map((x) => [x.job.id, x.question])).toEqual([
      ["big", "quote"],
      ["acc", "outcome"],
    ]);
    // answered: a quote, so lost; won, so won
    const answered = analyse([bigUnsent, acceptedThenOff], TODAY, "12m", new Map([["big", { quote: "quote" }], ["acc", { outcome: "won" }]]));
    expect(answered.top.winRate).toMatchObject({ won: 1, decided: 2 });
  });

  it("says apart a quote ServiceM8 closed itself with no answer", () => {
    const marked = job({ id: "m", status: "Unsuccessful", quoteSentOn: "2026-05-02", raisedOn: "2026-05-01", valueCents: 500_000 });
    const closed = job({ id: "c", status: "Unsuccessful", quoteSentOn: "2026-04-02", raisedOn: "2026-04-01", valueCents: 300_000, closedUnanswered: true });
    const q = analyse([marked, closed], TODAY, "12m").quotes;
    expect(q.unsuccessful).toEqual({ count: 1, cents: 500_000 });
    expect(q.closed).toEqual({ count: 1, cents: 300_000 });
    expect(q.lostJobs.map((l) => [l.job.id, l.why])).toEqual([
      ["m", "marked"],
      ["c", "closed"],
    ]);
  });

});
