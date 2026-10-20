import {
  ANYONE,
  DEFAULT_DOCS_STATE,
  certRow,
  dayWord,
  handoverRow,
  handoverState,
  letterRow,
  peopleOf,
  railState,
  readDocsState,
  rowsFor,
  sortRows,
  swmsRow,
  swmsState,
  viewCounts,
  viewsFor,
  withDocsState,
} from "../made";
import type { OrgSwmsSummary } from "@/lib/swms/query";
import type { OrgCertSummary } from "@/lib/certs/query";

/* Documents' rows, each in the job card's own words, and the list's state. */

const day = (iso: string) => iso.slice(0, 10);

const swms = (over: Partial<OrgSwmsSummary> = {}): OrgSwmsSummary => ({
  swmsId: "s-1",
  versionId: "v-2",
  version: 1,
  issuedAt: "2026-10-13T01:00:00.000Z",
  responsible: "Lyle Irving",
  signed: 2,
  total: 3,
  waitingOn: ["Sam Ikpeba"],
  issues: [],
  viewerCanSign: false,
  viewerSigned: false,
  jobUuid: "j-1",
  kind: "install",
  ...over,
});

const cert = (over: Partial<OrgCertSummary> = {}): OrgCertSummary => ({
  certificateId: "c-1",
  versionId: "cv-1",
  version: 1,
  title: "Mechanical Compliance Certificate",
  issuedAt: "2026-10-02T01:00:00.000Z",
  issuedBy: "Isaac Smith",
  issuedById: "isaac",
  documentId: "d-1",
  jobUuid: "j-2",
  ...over,
});

describe("a SWMS's state, as the job card words it", () => {
  it("says who it waits on, in orange", () => {
    expect(swmsState(swms())).toEqual({ state: "2 of 3 signed on, waiting on Sam Ikpeba", tone: "look" });
    expect(swmsState(swms({ signed: 1, waitingOn: ["Sam Ikpeba", "Dan Ruiz"] })).state).toBe("1 of 3 signed on, waiting on Sam Ikpeba and Dan Ruiz");
  });

  it("puts an issue raised at sign-on first", () => {
    const s = swms({ issues: [{ name: "Dan Ruiz", issue: "no anchor on the rear ridge" }] });
    expect(swmsState(s)).toEqual({ state: "Dan Ruiz raised: no anchor on the rear ridge", tone: "look" });
  });

  it("is green once everyone has signed on", () => {
    expect(swmsState(swms({ signed: 3, waitingOn: [] }))).toEqual({ state: "All signed on", tone: "good" });
  });

  it("opens on its sign-on, named for its kind, with no version number", () => {
    const r = swmsRow(swms({ version: 2, kind: "service" }), { label: "3342 Rifkin, Bellevue Hill", hue: "blue" }, day);
    expect(r).toMatchObject({ name: "Service SWMS, revised", href: "/dashboard/swms/v-2", newTab: false, by: "Lyle Irving", day: "2026-10-13", waiting: true });
  });
});

describe("the other kinds", () => {
  it("a certificate opens as paper in its own tab, and says only that it was issued", () => {
    expect(certRow(cert(), null, day)).toMatchObject({ state: "Issued", tone: "info", href: "/certificates/cv-1", newTab: true, by: "Isaac Smith" });
    expect(certRow(cert({ version: 2 }), null, day).state).toBe("Reissued");
  });

  it("a letter opens in its editor, with no job, saying who signs it", () => {
    const r = letterRow({ id: "l-1", title: "Employment confirmation", preview: "", date: "2026-10-09", signer: "Isaac Smith", writer: "Isaac Smith", updatedAt: "2026-10-09T01:00:00.000Z" }, day);
    expect(r).toMatchObject({ job: null, state: "Signed by Isaac Smith", href: "/dashboard/admin/letters/l-1", newTab: false });
    expect(letterRow({ id: "l-2", title: "x", preview: "", date: "", signer: null, writer: null, updatedAt: "2026-10-09T01:00:00.000Z" }, day).state).toBe("Not signed");
  });

  it("a handover sheet counts its Handover checks and opens the project's sheet", () => {
    expect(handoverState({ done: 3, total: 4 })).toEqual({ state: "3 of 4 checks done", tone: "look" });
    expect(handoverState({ done: 4, total: 4 }).tone).toBe("good");
    expect(handoverState({ done: 0, total: 0 }).tone).toBe("info");
    const r = handoverRow({ id: "p-1", name: "Hale Street apartments", updatedAt: "2026-09-28T01:00:00.000Z" }, { done: 3, total: 4 }, null, day);
    expect(r).toMatchObject({ name: "Handover, Hale Street apartments", href: "/handover/p-1", newTab: true });
  });
});

describe("the list's state", () => {
  const rows = [
    swmsRow(swms(), { label: "3342 Rifkin, Bellevue Hill", hue: "blue" }, day),
    certRow(cert(), { label: "3318 Hartley, Lane Cove", hue: "green" }, day),
    letterRow({ id: "l-1", title: "Employment confirmation", preview: "", date: "", signer: "Isaac Smith", writer: "Isaac Smith", updatedAt: "2026-10-09T01:00:00.000Z" }, day),
  ];

  it("reads the address, and an invented view or a kind the reader hasn't is All", () => {
    expect(readDocsState({ view: "letter", sort: "name", q: "rif", by: "Isaac Smith" }, ["swms", "letter"])).toEqual({ view: "letter", sort: "name", q: "rif", by: "Isaac Smith" });
    expect(readDocsState({ view: "letter" }, ["swms"]).view).toBe("all");
    expect(readDocsState({ view: "quotes", sort: "x" }, ["swms"])).toEqual(DEFAULT_DOCS_STATE);
  });

  it("writes the address, leaving the defaults off", () => {
    expect(withDocsState("http://h/dashboard/documents", DEFAULT_DOCS_STATE)).toBe("/dashboard/documents");
    expect(withDocsState("http://h/dashboard/documents", { ...DEFAULT_DOCS_STATE, view: "swms", q: "roof" })).toBe("/dashboard/documents?view=swms&q=roof");
  });

  it("offers only the kinds the reader has", () => {
    expect(viewsFor(["swms", "certificate", "handover"]).map((v) => v.label)).toEqual(["All", "SWMS", "Certificates", "Handover sheets"]);
  });

  it("narrows by view, person and search, and counts each view under them", () => {
    expect(rowsFor(rows, { view: "all", by: ANYONE, q: "lane cove" }).map((r) => r.kind)).toEqual(["certificate"]);
    expect(rowsFor(rows, { view: "all", by: "Isaac Smith", q: "" }).map((r) => r.kind)).toEqual(["certificate", "letter"]);
    expect(viewCounts(rows, { by: ANYONE, q: "" })).toMatchObject({ all: 3, swms: 1, certificate: 1, letter: 1, handover: 0 });
    expect(peopleOf(rows).map((p) => p.value)).toEqual(["Isaac Smith", "Lyle Irving"]);
  });

  it("sorts newest first, oldest first, or by name", () => {
    expect(sortRows(rows, "newest").map((r) => r.kind)).toEqual(["swms", "letter", "certificate"]);
    expect(sortRows(rows, "oldest").map((r) => r.kind)).toEqual(["certificate", "letter", "swms"]);
    expect(sortRows(rows, "name").map((r) => r.name)).toEqual(["Employment confirmation", "Installation SWMS", "Mechanical Compliance Certificate"]);
  });
});

describe("the Updated column and the Templates rail", () => {
  it("says Today, Yesterday, a weekday this week, then the date", () => {
    expect(dayWord("2026-10-13", "2026-10-13")).toBe("Today");
    expect(dayWord("2026-10-12", "2026-10-13")).toBe("Yesterday");
    expect(dayWord("2026-10-08", "2026-10-13")).toBe("Thursday");
    expect(dayWord("2026-10-02", "2026-10-13")).toBe("2 October");
    expect(dayWord("2025-12-02", "2026-10-13")).toBe("2 December 2025");
    expect(dayWord("", "2026-10-13")).toBe("");
  });

  it("words an approval in Settings' own words: approved in green with its day, waiting in orange", () => {
    expect(railState({ text: "Approved", tone: "on" }, "Wed 3 Sep")).toEqual({ text: "Approved Wed 3 Sep", tone: "good" });
    expect(railState({ text: "Waiting for your approval", tone: "warn" }, null)).toEqual({ text: "Waiting for your approval", tone: "look" });
    expect(railState(undefined, null)).toBeNull();
  });
});
