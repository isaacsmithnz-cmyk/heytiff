import { latestPerJob, officeLists, placeEnding, type EndingRow, type JobFacts } from "../office-lists-plan";

/* Where a visit's answer puts its job for the office, and when it leaves. */

const TODAY = "2026-11-11";
const job = (over: Partial<JobFacts> = {}): JobFacts => ({
  number: "3324",
  suburb: "Darling Point",
  status: "Work Order",
  active: true,
  invoiced: false,
  quoteSentOn: "2026-09-17",
  workOrderOn: "2026-09-20",
  quoted: 9856,
  ...over,
});
const said = (answer: EndingRow["ending"]["answer"], detail: EndingRow["ending"]["detail"] = {}, day = "2026-11-10", charge: EndingRow["ending"]["charge"] = { kind: "job" }): EndingRow => ({
  jobUuid: "J1",
  day,
  ending: { answer, detail, charge },
  by: "Isaac",
});

describe("Ready to invoice", () => {
  it("holds a finished job as quoted, until it's Completed or invoiced", () => {
    expect(placeEnding(said("finished"), job(), false, TODAY)).toEqual([{ list: "ready", jobUuid: "J1", day: "2026-11-10", title: "3324, Darling Point", sub: "Finished, as quoted, $9,856, Isaac, 10 Nov", days: 1, tone: null }]);
    expect(placeEnding(said("finished"), job({ status: "Completed" }), false, TODAY)).toEqual([]);
    expect(placeEnding(said("finished"), job({ invoiced: true }), false, TODAY)).toEqual([]);
    expect(placeEnding(said("finished", { checked: "2026-11-11" }), job(), false, TODAY)).toEqual([]);
  });
  it("never holds a visit at no charge", () => {
    expect(placeEnding(said("finished", {}, "2026-11-10", { kind: "none", reason: "site_meeting" }), job(), false, TODAY)).toEqual([]);
  });
  it("with a quote to build, is to invoice and its quote waits too, on the quote job once there is one", () => {
    const quoted = said("finished", { quoteToo: true, quoteWords: "ducted upstairs" });
    expect(placeEnding(quoted, job(), false, TODAY).map((r) => [r.list, r.sub])).toEqual([
      ["ready", "Finished, as quoted, $9,856, Isaac, 10 Nov"],
      ["quotes", "To quote, ducted upstairs, from 3324, Darling Point"],
    ]);
    const opened = said("finished", { quoteToo: true, quoteWords: "ducted upstairs", quoteJob: "Q1" });
    const q = job({ number: "3530", suburb: null, status: "Quote", quoteSentOn: null, workOrderOn: null, quoted: 0 });
    expect(placeEnding(opened, job(), false, TODAY, q)[1]).toMatchObject({ list: "quotes", jobUuid: "Q1", title: "3530, Darling Point", sub: "To price, ducted upstairs" });
    expect(placeEnding(opened, job(), false, TODAY, { ...q, quoteSentOn: "2026-11-11", quoted: 4200 })[1]).toMatchObject({ sub: "$4,200, sent 11 Nov", days: 0 });
  });
});

describe("To book and Parts on order", () => {
  it("waits on parts until they're in, then is to book from that day", () => {
    expect(placeEnding(said("coming_back", { waiting: "parts", needed: "2 WiFi modules" }, "2026-10-22"), job(), false, TODAY)[0]).toMatchObject({ list: "parts", sub: "2 WiFi modules, Isaac, 22 Oct", days: 20, tone: "late" });
    expect(placeEnding(said("coming_back", { waiting: "parts", partsIn: "2026-11-11" }, "2026-10-22"), job(), false, TODAY)[0]).toMatchObject({ list: "book", sub: "Parts in 11 Nov, Isaac, 22 Oct", days: 0 });
  });
  it("says why it's to book, and leaves once a visit's booked", () => {
    expect(placeEnding(said("coming_back", { waiting: "access" }, "2026-11-02"), job(), false, TODAY)[0]).toMatchObject({ list: "book", sub: "No access, Isaac, 2 Nov", days: 9, tone: "getting" });
    expect(placeEnding(said("coming_back", { waiting: "access" }), job(), true, TODAY)).toEqual([]);
  });
});

describe("Quotes waiting", () => {
  it("is to price until sent, then waits from the day it went, until accepted", () => {
    const q = job({ status: "Quote", quoteSentOn: null, workOrderOn: null, quoted: 3069.16 });
    expect(placeEnding(said("quote_first", { quoteWho: "Luke" }, "2026-11-02"), q, false, TODAY)[0]?.sub).toBe("To price, on Luke");
    expect(placeEnding(said("quote_first", {}, "2026-11-02"), { ...q, quoteSentOn: "2026-11-05" }, false, TODAY)[0]).toMatchObject({ sub: "$3,069.16, sent 5 Nov", days: 6 });
    expect(placeEnding(said("quote_first", {}, "2026-11-02"), { ...q, quoteSentOn: "2026-11-05", workOrderOn: "2026-11-09" }, false, TODAY)).toEqual([]);
  });
});

it("a warranty visit at no charge waits on Warranty claims, beside its answer's list, until claimed", () => {
  const w = said("coming_back", { waiting: "parts", needed: "a fan motor" }, "2026-11-04", { kind: "none", reason: "warranty", words: "Fan motor, Daikin" });
  expect(placeEnding(w, job(), false, TODAY).map((r) => [r.list, r.sub])).toEqual([
    ["parts", "a fan motor, Isaac, 4 Nov"],
    ["claims", "Fan motor, Daikin, Isaac, 4 Nov"],
  ]);
  expect(placeEnding({ ...w, ending: { ...w.ending, detail: { ...w.ending.detail, claimed: "2026-11-11" } } }, job(), false, TODAY).map((r) => r.list)).toEqual(["parts"]);
});

it("Can't go ahead is on no list, and an inactive job on none", () => {
  expect(placeEnding(said("cant", { reason: "cancelled" }), job(), false, TODAY)).toEqual([]);
  expect(placeEnding(said("finished"), job({ active: false }), false, TODAY)).toEqual([]);
});

it("only a job's latest answer counts, and the lists come oldest first", () => {
  const rows = latestPerJob([said("coming_back", { waiting: "access" }, "2026-11-01"), said("finished", {}, "2026-11-10")]);
  expect(rows.map((r) => r.ending.answer)).toEqual(["finished"]);
  const lists = officeLists([
    { list: "book", jobUuid: "a", day: "", title: "a", sub: "", days: 2, tone: null },
    { list: "book", jobUuid: "b", day: "", title: "b", sub: "", days: 9, tone: "getting" },
    { list: "ready", jobUuid: "c", day: "", title: "c", sub: "", days: 1, tone: null },
  ]);
  expect(lists.map((l) => [l.title, l.rows.map((r) => r.jobUuid)])).toEqual([
    ["Ready to invoice", ["c"]],
    ["To book", ["b", "a"]],
  ]);
});
