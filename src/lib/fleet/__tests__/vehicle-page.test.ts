import type { Vehicle, VehicleLog, VehiclePolicy } from "@/components/fleet/logic";
import { vehiclePageHref } from "@/lib/shell/links";
import {
  headFacts,
  issueGroups,
  kmChart,
  kmPerMonth,
  lastFuel,
  nextServiceHeading,
  nickname,
  parseVehicleSection,
  readings,
  renewalHistory,
  renewalRows,
  renewalWord,
  sectionsFor,
  serviceEvery,
  serviceHistory,
  serviceRows,
  serviceSpend,
  statusWord,
  vehicleTabLabel,
  vehicleTitle,
} from "../vehicle-page";

/* What a vehicle's own page SAYS (v2; each fact once since Isaac's mock of
   24 October 2026): its sections, the title and the one grey line, each
   section's rows, all from the rules the register and the card already use. */

const TODAY = "2026-10-18";

const hilux = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "v1",
  name: "Hilux",
  make: "Toyota",
  model: "Hilux SR5",
  year: 2021,
  plate: "XQG41B",
  plateState: "NSW",
  status: "active",
  odometer: 128400,
  regoDays: 200,
  insuranceDays: 140,
  ctpDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 120200,
  serviceIntervalMonths: 6,
  serviceDays: 73,
  motorised: true,
  assignedTo: "s-lyle",
  value: 41000,
  purchasePrice: 58990,
  purchaseDateDays: 900,
  lastServiceDays: 110,
  ...over,
});

const log = (over: Partial<VehicleLog> & Pick<VehicleLog, "id" | "kind" | "ago">): VehicleLog => ({
  vehicleId: "v1",
  staffId: "s-lyle",
  staffName: "Lyle Irving",
  when: `day ${over.ago}`,
  ...over,
});

const LOGS: VehicleLog[] = [
  log({ id: "f1", kind: "fuel", ago: 2, litres: 68.2, cost: 141.2, odo: 128400, station: "Ampol Botany", paidWith: "company", hasReceipt: true }),
  log({ id: "i1", kind: "issue", ago: 3, note: "Aircon blowing warm", odo: 128210, status: "open" }),
  log({ id: "f0", kind: "fuel", ago: 9, litres: 70, cost: 150.6, odo: 127650, station: "BP Rosebery" }),
  log({ id: "o1", kind: "odo", ago: 20, odo: 127100 }),
  log({ id: "i0", kind: "issue", ago: 47, note: "Rear left tyre slow leak", odo: 125020, status: "resolved", staffName: "Dan Walsh" }),
  log({ id: "s1", kind: "service", ago: 110, note: "Logbook service, 120,000 km", odo: 120200, station: "Botany Toyota", cost: 486, staffName: "Isaac Smith", workDone: "Engine oil and filter\nRotate tyres" }),
  log({ id: "s0", kind: "service", ago: 289, note: "Logbook service, 110,000 km", odo: 110150, station: "Botany Toyota", cost: 412, staffName: "Isaac Smith" }),
  log({ id: "o0", kind: "odo", ago: 351, odo: 101000 }),
];

const POLICIES: VehiclePolicy[] = [
  { id: "p1", kind: "insurance", provider: "NRMA", premium: 2140, startsOn: "2026-03-07", expiresOn: "2027-03-07", documentId: null, cover: "comprehensive", excess: 1000, createdAt: "2026-03-01T00:00:00Z" },
  { id: "p0", kind: "insurance", provider: "NRMA", premium: 1990, startsOn: "2025-03-07", expiresOn: "2026-03-07", documentId: null, createdAt: "2025-03-01T00:00:00Z" },
  { id: "r1", kind: "rego", provider: "Transport for NSW", premium: null, startsOn: null, expiresOn: "2026-11-12", documentId: null, createdAt: "2025-11-01T00:00:00Z" },
];

describe("the sections", () => {
  it("are all six for the register, Kilometres folded into Service, and leave Documents and Money out for a driver", () => {
    expect(sectionsFor({ register: true, motorised: true })).toEqual(["overview", "service", "fuel", "issues", "documents", "money"]);
    expect(sectionsFor({ register: false, motorised: true })).toEqual(["overview", "service", "fuel", "issues"]);
  });

  it("have no Fuel on something with no motor", () => {
    expect(sectionsFor({ register: true, motorised: false })).toEqual(["overview", "service", "issues", "documents", "money"]);
  });

  it("land an old ?tab=kilometres on Service, where the readings went", () => {
    for (const lens of [true, false]) expect(parseVehicleSection("kilometres", sectionsFor({ register: lens, motorised: true }))).toBe("service");
    expect(parseVehicleSection("Kilometres", sectionsFor({ register: true, motorised: false }))).toBe("service");
    expect(parseVehicleSection("constructor", sectionsFor({ register: true, motorised: true }))).toBe("overview");
  });

  it("are named by ?tab=, and anything the viewer hasn't got is Overview", () => {
    const driver = sectionsFor({ register: false, motorised: true });
    expect(parseVehicleSection("Fuel", driver)).toBe("fuel");
    expect(parseVehicleSection("money", driver)).toBe("overview");
    expect(parseVehicleSection(["fuel", "issues"], driver)).toBe("overview");
    expect(parseVehicleSection(undefined, driver)).toBe("overview");
    expect(parseVehicleSection("money", sectionsFor({ register: true, motorised: true }))).toBe("money");
  });
});

describe("the page's address", () => {
  it("is the vehicle's id, encoded, with the section after it unless it's Overview", () => {
    expect(vehiclePageHref("v1")).toBe("/dashboard/vehicles/v1");
    expect(vehiclePageHref("v1", "overview")).toBe("/dashboard/vehicles/v1");
    expect(vehiclePageHref("v/odd id", "kilometres")).toBe("/dashboard/vehicles/v%2Fodd%20id?tab=kilometres");
  });
});

const hiace = (over: Partial<Vehicle> = {}): Vehicle => hilux({ name: "Zucky", make: "Toyota", model: "Hiace", year: 2022, plate: "EVD72G", ...over });

describe("the title", () => {
  it("is the make and model, the brand first (Isaac: \"At the top, Toyota Hiace\")", () => {
    expect(vehicleTitle(hiace())).toBe("Toyota Hiace");
    expect(vehicleTitle(hilux())).toBe("Toyota Hilux SR5");
    expect(vehicleTitle(hiace({ model: "Toyota Hiace" }))).toBe("Toyota Hiace");
  });

  it("falls back to the vehicle's own name, then to the word Vehicle", () => {
    expect(vehicleTitle(hiace({ make: "", model: "" }))).toBe("Zucky");
    expect(vehicleTitle(hiace({ make: "", model: "", name: "" }))).toBe("Vehicle");
    expect(vehicleTitle(hiace({ make: "Isuzu", model: "" }))).toBe("Isuzu");
  });

  it("leaves the nickname to the grey line, and drops one that is only the plate or the title again", () => {
    expect(nickname(hiace())).toBe("Zucky");
    expect(nickname(hiace({ name: "evd 72g" }))).toBeNull();
    expect(nickname(hiace({ name: "Toyota Hiace" }))).toBeNull();
    expect(nickname(hiace({ make: "", model: "" }))).toBeNull();
  });
});

describe("the tab's name", () => {
  it("is the title and the plate, as the head reads, or the plate alone", () => {
    expect(vehicleTabLabel(hiace())).toBe("Toyota Hiace EVD72G");
    expect(vehicleTabLabel(hiace({ make: "", model: "", name: "" }))).toBe("EVD72G");
    expect(vehicleTabLabel(hiace({ plate: " " }))).toBe("Toyota Hiace");
    expect(vehicleTabLabel(hiace({ make: "", model: "", name: "EVD 72G" }))).toBe("EVD72G");
  });
});

describe("the grey line", () => {
  it("is the year, the nickname and who drives it", () => {
    expect(headFacts(hiace(), "Isaac Smith")).toBe("2022, Zucky, Isaac Smith drives it");
    expect(headFacts(hiace({ name: "" }), null)).toBe("2022, No driver");
    expect(headFacts(hiace({ year: 0 }), "you")).toBe("Zucky, You drive it");
    expect(headFacts(hiace({ motorised: false }), "Dan Walsh")).toBe("2022, Zucky, Dan Walsh tows it");
  });

  it("says no kilometres and no make or model: the title and Overview have those", () => {
    const line = headFacts(hilux(), "Lyle Irving");
    expect(line).not.toMatch(/km|Toyota|Hilux SR5/);
  });

  it("ends in the status, as a word in its state", () => {
    expect(statusWord("active")).toEqual({ word: "In service", tone: "good" });
    expect(statusWord("offroad")).toEqual({ word: "Off road", tone: "wrong" });
    expect(statusWord("for_sale")).toEqual({ word: "For sale", tone: "info" });
  });
});

describe("Overview's renewals", () => {
  it("say each one as a word in its state, with the day it runs to", () => {
    const rows = renewalRows(hilux({ regoDays: 25 }), POLICIES, TODAY, 30);
    expect(rows.map((r) => [r.label, r.word.word, r.date, r.onFile])).toEqual([
      ["Rego", "Due in 25 days", "to 12 Nov 2026", true],
      ["Green slip", "Current", "to 6 May 2027", true],
      ["Insurance", "Current", "to 7 Mar 2027", true],
    ]);
    expect(rows[0].word.tone).toBe("look");
  });

  it("say Not on file, with no date and an Add, for one nobody entered", () => {
    const ctp = renewalRows(hilux({ ctpDays: null }), POLICIES, TODAY, 30).find((r) => r.kind === "ctp")!;
    expect(ctp).toMatchObject({ word: { word: "Not on file", tone: "info" }, date: null, onFile: false });
    expect(renewalWord(-4, 30)).toEqual({ word: "4 days overdue", tone: "wrong" });
    expect(renewalRows(hilux({ regoDays: -4 }), [], TODAY, 30)[0].date).toBe("ended 14 Oct 2026");
  });
});

describe("Overview's service", () => {
  it("says the odometer once, read when, then the next service and the last", () => {
    const rows = serviceRows(hilux(), LOGS, TODAY, 30);
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Odometer", "128,400 km, read day 2"],
      ["Next service", "At 130,200 km or by 30 Dec 2026, 1,800 km to go"],
      ["Last service", "day 110"],
    ]);
    expect(rows.every((r) => !r.word)).toBe(true);
  });

  it("says a service close or past as a word, and nothing for a cycle nobody set", () => {
    expect(serviceRows(hilux({ odometer: 129400 }), LOGS, TODAY, 30)[1]).toMatchObject({ value: "At 130,200 km or by 30 Dec 2026, 800 km to go", word: { word: "Due soon", tone: "look" } });
    expect(serviceRows(hilux({ odometer: 131000 }), LOGS, TODAY, 30)[1]).toMatchObject({ value: expect.stringContaining("800 km past it"), word: { word: "Overdue", tone: "wrong" } });
    expect(serviceRows(hilux({ serviceIntervalKm: null, serviceDays: null }), LOGS, TODAY, 30)[1]).toMatchObject({ value: "No cycle set", quiet: true });
  });

  it("has no odometer on something with no motor, and counts its days instead", () => {
    const rows = serviceRows(hilux({ motorised: false }), [], TODAY, 30);
    expect(rows.map((r) => r.label)).toEqual(["Next service", "Last service"]);
    expect(rows[0].value).toBe("By 30 Dec 2026, 73 days to go");
    expect(rows[1]).toMatchObject({ value: "None logged", quiet: true });
    expect(serviceRows(hilux({ motorised: false }), [], TODAY, 30, 110)[1].value).toBe("30 Jun 2026");
  });

  it("says the last fill: its day, then the litres, the cost and the station", () => {
    expect(lastFuel(LOGS)).toMatchObject({ when: "day 2", line: "68.2 litres, $141.20, Ampol Botany" });
    expect(lastFuel([])).toBeNull();
  });
});

describe("Service", () => {
  it("lists the services newest first, with what servicing cost this year", () => {
    expect(serviceHistory(LOGS, TODAY).map((l) => [l.id, l.on])).toEqual([
      ["s1", "30 Jun 2026"],
      ["s0", "2 Jan 2026"],
    ]);
    expect(serviceSpend(LOGS)).toBe(898);
    expect(serviceSpend([])).toBeNull();
  });

  it("names the next one and the cycle", () => {
    expect(nextServiceHeading(hilux(), TODAY)).toBe("At 130,200 km or by 30 Dec 2026");
    expect(serviceEvery(hilux(), 30)).toBe("Every 10,000 km or 6 months, whichever comes first. 1,800 km to go.");
    expect(nextServiceHeading(hilux({ serviceIntervalKm: null, serviceDays: null }), TODAY)).toBeNull();
  });
});

describe("Issues", () => {
  it("puts the open ones first, then the fixed", () => {
    const { open, fixed } = issueGroups(LOGS);
    expect(open.map((l) => l.id)).toEqual(["i1"]);
    expect(fixed.map((l) => l.id)).toEqual(["i0"]);
  });
});

describe("Kilometres", () => {
  it("lists every reading, newest first, with how far since the last and where it came from", () => {
    const rs = readings(LOGS, TODAY);
    expect(rs.map((r) => [r.odo, r.since, r.from])).toEqual([
      [128400, 190, "Fuel docket, Ampol Botany"],
      [128210, 560, "Issue reported"],
      [127650, 550, "Fuel docket, BP Rosebery"],
      [127100, 2080, "Read off the dash"],
      [125020, 4820, "Issue reported"],
      [120200, 10050, "Service, Botany Toyota"],
      [110150, 9150, "Service, Botany Toyota"],
      [101000, null, "Read off the dash"],
    ]);
  });

  it("says kilometres a month only from two readings four weeks apart", () => {
    const rs = readings(LOGS, TODAY);
    expect(kmPerMonth(rs)).toMatchObject({ perMonth: 2390, spanDays: 349 });
    expect(kmPerMonth(rs.slice(0, 2))).toBeNull();
  });

  it("draws the line from the readings, with the service due inside the scale", () => {
    const chart = kmChart(readings(LOGS, TODAY), TODAY, 130200)!;
    expect(chart.points).toHaveLength(8);
    expect(chart.path.startsWith("M")).toBe(true);
    expect(chart.due?.label).toBe("Service due, 130,200 km");
    expect(chart.last?.label).toBe("128,400 km");
    expect(chart.xTicks.map((t) => t.label)).toContain("Oct");
    expect(kmChart(readings(LOGS.slice(0, 1), TODAY), TODAY, null)).toBeNull();
  });
});

describe("Documents", () => {
  it("lists each renewal, the one in force first in its kind", () => {
    expect(renewalHistory(POLICIES).map((r) => [r.name, r.current])).toEqual([
      ["Rego to 12 Nov 2026", true],
      ["Insurance to 7 Mar 2027", true],
      ["Insurance to 7 Mar 2026", false],
    ]);
  });
});
