import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { QuoteFacts } from "../quote-card";
import { acceptedRows, landingKind, landingMoney, landingOf, landingPeople, progressLine, progressState, whoWords, type LandingRaw } from "../quote-landing";

/* The Quote tab's landing (Isaac, 2026-10-18): the quote's name, who last
   worked on it and when, its versions and variations newest first, and
   what each comes to, only for a reader with money access. */

const facts = (o: Partial<QuoteFacts> = {}): QuoteFacts => ({
  lines: 6,
  options: 1,
  toConfirm: 0,
  changedAt: "2026-10-10T00:00:00Z",
  talked: true,
  drafted: false,
  approved: false,
  version: 1,
  sent: null,
  accepted: [],
  ...o,
});
const WHEN = { day: fmtAuWeekdayDayMonth, time: (at: string) => fmtAuTime(new Date(at)) };

const option = (exGstCents: number) => ({ name: "", exGstCents, incGstCents: Math.round(exGstCents * 1.1), lines: [] });
const raw = (o: Partial<LandingRaw> = {}): LandingRaw => ({
  byHand: { accepted: [], names: ["Ducted, zoned"], proposal: null, variations: [] },
  versions: [],
  lines: [],
  firstAt: "2026-10-16T22:00:00Z",
  lastSaid: null,
  working: false,
  acceptedAt: null,
  names: { "u-isaac": "Isaac Smith", "u-luke": "Luke Ingold" },
  optionCents: [2457463, 2600000],
  money: true,
  ...o,
});
const proposal = (o: Record<string, unknown> = {}) =>
  ({ title: "Mitsubishi Electric VRF", intro: "", options: [], notIncluded: [], choice: "one", payment: { preset: "deposit", stages: [] }, notes: [], updatedAt: "", approvedAt: null, approvedBy: null, ...o }) as never;
const variation = (o: Record<string, unknown> = {}) => ({ n: 1, option: 2, of: 1, what: "return grille in Bed 2", startedAt: "2026-10-22T01:00:00Z", startedBy: "u-luke", approvedAt: null, acceptedAt: null, ...o });

describe("landingOf", () => {
  it("names the quote by its proposal's title, else the open option's name", () => {
    expect(landingOf(raw({ byHand: { ...raw().byHand, proposal: proposal() } })).name).toBe("Mitsubishi Electric VRF");
    expect(landingOf(raw()).name).toBe("Ducted, zoned");
    expect(landingOf(raw({ byHand: { ...raw().byHand, names: [] } })).name).toBe("");
  });

  it("says who last worked on it: their last word to Tiff or line change, whichever is later, never Tiff herself", () => {
    const later = landingOf(
      raw({
        lastSaid: { author: "u-isaac", at: "2026-10-17T11:24:00Z" },
        lines: [
          { updatedAt: "2026-10-17T09:00:00Z", updatedBy: "u-luke" },
          { updatedAt: "2026-10-17T12:00:00Z", updatedBy: "tiff" },
        ],
      })
    );
    expect(later.who).toEqual({ name: "Isaac Smith", at: "2026-10-17T11:24:00Z", now: false });
    const changed = landingOf(raw({ lastSaid: { author: "u-isaac", at: "2026-10-17T08:00:00Z" }, lines: [{ updatedAt: "2026-10-17T09:00:00Z", updatedBy: "u-luke" }], working: true }));
    expect(changed.who).toEqual({ name: "Luke Ingold", at: "2026-10-17T09:00:00Z", now: true });
  });

  it("keeps the when where no staff profile names the person, and nothing where nobody has worked on it", () => {
    expect(landingOf(raw({ lastSaid: { author: "u-gone", at: "2026-10-17T11:24:00Z" } })).who).toEqual({ name: null, at: "2026-10-17T11:24:00Z", now: false });
    expect(landingOf(raw()).who).toBeNull();
  });

  it("asks for the names of everyone it mentions, once each, and never Tiff's", () => {
    const people = landingPeople(
      raw({
        lastSaid: { author: "u-isaac", at: "x" },
        lines: [{ updatedAt: "y", updatedBy: "tiff" }],
        byHand: { ...raw().byHand, proposal: proposal({ approvedBy: "u-isaac" }), variations: [variation()] },
        versions: [{ n: 1, approvedAt: null, approvedBy: "u-owner", madeAt: "", madeBy: "u-office", options: [] }],
      })
    );
    expect(people.sort()).toEqual(["u-isaac", "u-luke", "u-office", "u-owner"]);
  });

  it("prices the open option, each kept version, and each variation as the difference it makes, newest first", () => {
    const l = landingOf(
      raw({
        byHand: { ...raw().byHand, accepted: [1], variations: [variation(), variation({ n: 2, option: 3, approvedAt: "x" })] },
        optionCents: [2457463, 2600000, 2641200, 2590000],
        versions: [
          { n: 1, approvedAt: "a", approvedBy: "u-isaac", madeAt: "b", madeBy: "u-luke", options: [option(1), option(2380036)] },
          { n: 2, approvedAt: "c", approvedBy: null, madeAt: "d", madeBy: "u-luke", options: [option(1), option(2500000)] },
        ],
        acceptedAt: "2026-10-21T22:00:00Z",
      })
    );
    expect(l.totalCents).toBe(2600000);
    expect(l.versions.map((v) => [v.n, v.by, v.cents])).toEqual([
      [2, "Luke Ingold", 2500000],
      [1, "Isaac Smith", 2380036],
    ]);
    expect(l.variations.map((v) => [v.n, v.by, v.cents])).toEqual([
      [2, "Luke Ingold", -10000],
      [1, "Luke Ingold", 41200],
    ]);
    expect(l.acceptedAt).toBe("2026-10-21T22:00:00Z");
  });

  it("takes every figure out for a reader without money access", () => {
    const l = landingOf(
      raw({
        money: false,
        byHand: { ...raw().byHand, accepted: [0], variations: [variation({ of: 0 })] },
        versions: [{ n: 1, approvedAt: "a", madeAt: "b", options: [option(2380036)] }],
      })
    );
    expect(l.money).toBe(false);
    expect(l.totalCents).toBeNull();
    expect(l.versions[0]!.cents).toBeNull();
    expect(l.variations[0]!.cents).toBeNull();
    expect(JSON.stringify(l)).not.toMatch(/2457463|2380036|2600000/);
  });

  it("says nothing of an accepted day on a quote no longer accepted", () => {
    expect(landingOf(raw({ acceptedAt: "2026-10-21T22:00:00Z" })).acceptedAt).toBeNull();
  });
});

describe("the words", () => {
  it("is one of three states", () => {
    expect(landingKind(facts({ lines: 0, talked: false }))).toBe("first");
    expect(landingKind(facts({ lines: 0, talked: false, drafted: true }))).toBe("progress");
    expect(landingKind(facts())).toBe("progress");
    expect(landingKind(facts({ accepted: [0] }))).toBe("accepted");
  });

  it("words where a quote in progress stands, in its state's colour", () => {
    expect(progressState(facts({ toConfirm: 4 }), WHEN)).toEqual({ tone: "look", word: "Scope, 4 to settle", rest: "" });
    expect(progressState(facts(), WHEN)).toEqual({ tone: "info", word: "Scope, 6 lines", rest: "" });
    expect(progressState(facts({ lines: 0 }), WHEN)).toEqual({ tone: "info", word: "Brief, with Tiff", rest: "" });
    expect(progressState(facts({ approved: true, version: 2 }), WHEN)).toEqual({ tone: "good", word: "Version 2 approved", rest: "" });
    expect(progressState(facts({ approved: true, sent: { at: "2026-10-11T00:00:00Z", trial: true } }), WHEN)).toEqual({ tone: "good", word: "Approved", rest: ", trial run to ServiceM8" });
  });

  /* a send is a timestamp: 21:30 UTC on the 12th is 8:30 on Tuesday the
     13th in Sydney, and the card said Monday all morning */
  it("words the day a send was in Australia, not its UTC date", () => {
    expect(progressState(facts({ approved: true, sent: { at: "2026-10-12T21:30:00Z", trial: false } }), WHEN)).toEqual({ tone: "look", word: "Waiting for the client", rest: ", sent Tue 13 Oct" });
  });

  it("says the version, the options and the day it was begun", () => {
    expect(progressLine(facts({ options: 2, version: 2 }), { startedAt: "2026-10-16T22:00:00Z" }, WHEN)).toBe("Version 2, 2 options, started Sat 17 Oct");
    expect(progressLine(facts(), { startedAt: null }, WHEN)).toBe("Version 1");
  });

  it("says who is on it with Tiff and when, or the when alone", () => {
    const at = "2026-10-17T11:24:00Z";
    expect(whoWords({ name: "Isaac Smith", at, now: false }, true, WHEN)).toBe("Isaac Smith, with Tiff, last Sat 17 Oct at 10:24 pm");
    expect(whoWords({ name: null, at, now: false }, true, WHEN)).toBe("With Tiff, last Sat 17 Oct at 10:24 pm");
    expect(whoWords({ name: "Luke Ingold", at, now: true }, true, WHEN)).toBe("Luke Ingold, with Tiff, now");
    expect(whoWords({ name: "Luke Ingold", at, now: false }, false, WHEN)).toBe("Luke Ingold, last Sat 17 Oct at 10:24 pm");
    expect(whoWords(null, true, WHEN)).toBe("");
  });

  it("lists under an accepted quote each variation, the version accepted, then the versions kept, newest first", () => {
    const l = landingOf(
      raw({
        byHand: { ...raw().byHand, accepted: [0], proposal: proposal({ approvedBy: "u-isaac" }), variations: [variation({ of: 0, option: 1, acceptedAt: "2026-10-23T01:00:00Z" }), variation({ n: 2, of: 0, option: 2, approvedAt: "x", what: "" })] },
        optionCents: [2457463, 2498663, 2457463],
        versions: [{ n: 1, approvedAt: "2026-10-19T22:00:00Z", madeAt: "2026-10-20T01:00:00Z", madeBy: "u-luke", options: [option(2380036)] }],
        acceptedAt: "2026-10-21T22:00:00Z",
      })
    );
    const rows = acceptedRows(facts({ version: 2 }), l, WHEN);
    expect(rows.map((r) => [r.title, r.state.tone, `${r.state.word}${r.state.rest}`, r.who, r.cents, r.open])).toEqual([
      ["Variation 2", "look", "Waiting for the client", "Luke Ingold", 0, true],
      ["Variation 1", "good", "Accepted Fri 23 Oct, return grille in Bed 2", "Luke Ingold", 41200, false],
      ["Version 2", "good", "Accepted Thu 22 Oct", "Isaac Smith", 2457463, false],
      ["Version 1", "info", "Replaced, approved Tue 20 Oct", "Luke Ingold", 2380036, false],
    ]);
  });

  it("writes a difference with its sign", () => {
    expect(landingMoney(2457463)).toBe("$24,574.63");
    expect(landingMoney(41200, true)).toBe("+$412.00");
    expect(landingMoney(-8000, true)).toBe("−$80.00");
  });
});
