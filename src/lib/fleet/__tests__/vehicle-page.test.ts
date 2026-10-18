import type { Vehicle, VehicleLog, VehiclePolicy } from "@/components/fleet/logic";
import { vehiclePageHref } from "@/lib/shell/links";
import {
  headLine,
  headState,
  issueGroups,
  kmChart,
  kmPerMonth,
  latestRows,
  nextServiceHeading,
  parseVehicleSection,
  readings,
  renewalHistory,
  renewalWord,
  sectionsFor,
  serviceEvery,
  serviceHistory,
  serviceSpend,
  standsRows,
  vehicleTabLabel,
} from "../vehicle-page";

/* What a vehicle's own page SAYS (v2, the boards v2-board-vehicle-*): its
   sections, the head's one state word, each section's rows, all from the
   rules the register and the card already use. */

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
  it("are all seven for the register, and leave Documents and Money out for a driver", () => {
    expect(sectionsFor({ register: true, motorised: true })).toEqual(["overview", "service", "issues", "kilometres", "fuel", "documents", "money"]);
    expect(sectionsFor({ register: false, motorised: true })).toEqual(["overview", "service", "issues", "kilometres", "fuel"]);
  });

  it("have no Kilometres and no Fuel on something with no motor", () => {
    expect(sectionsFor({ register: true, motorised: false })).toEqual(["overview", "service", "issues", "documents", "money"]);
  });

  it("are named by ?tab=, and anything the viewer hasn't got is Overview", () => {
    const driver = sectionsFor({ register: false, motorised: true });
    expect(parseVehicleSection("Kilometres", driver)).toBe("kilometres");
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

describe("the tab's name", () => {
  it("is the name and the rego, or the rego alone", () => {
    expect(vehicleTabLabel({ name: "Hilux", plate: "XQG 41B" })).toBe("Hilux XQG 41B");
    expect(vehicleTabLabel({ name: "", plate: "XQG 41B" })).toBe("XQG 41B");
    expect(vehicleTabLabel({ name: "xqg 41b", plate: "XQG 41B" })).toBe("xqg 41b");
  });
});

describe("the head", () => {
  it("says rego due in N days in orange inside the window", () => {
    expect(headState(hilux({ regoDays: 25 }), 0, 30)).toEqual({ word: "Rego due in 25 days", tone: "look" });
  });

  it("says rego overdue in red", () => {
    expect(headState(hilux({ regoDays: -3 }), 0, 30)).toEqual({ word: "Rego 3 days overdue", tone: "wrong" });
    expect(headState(hilux({ regoDays: -1 }), 0, 30)).toEqual({ word: "Rego 1 day overdue", tone: "wrong" });
  });

  it("puts what is wrong before what needs a look", () => {
    expect(headState(hilux({ regoDays: 25, ctpDays: -2 }), 0, 30)).toEqual({ word: "Green slip 2 days overdue", tone: "wrong" });
    expect(headState(hilux({ status: "offroad", regoDays: 25 }), 0, 30)).toEqual({ word: "Off road", tone: "wrong" });
  });

  it("says an open issue or a service due as the register's chips say them", () => {
    expect(headState(hilux(), 1, 30)).toEqual({ word: "1 issue open", tone: "look" });
    expect(headState(hilux({ odometer: 129400 }), 0, 30)).toEqual({ word: "Service in 800 km", tone: "look" });
  });

  it("says its status when nothing needs a look", () => {
    expect(headState(hilux(), 0, 30)).toEqual({ word: "In service", tone: "good" });
    expect(headState(hilux({ status: "for_sale" }), 0, 30)).toEqual({ word: "For sale", tone: "info" });
    expect(headState(hilux({ status: "sold", regoDays: -40 }), 0, 30)).toEqual({ word: "Sold", tone: "info" });
  });

  it("is one grey line: the driver, the kilometres, the model", () => {
    expect(headLine(hilux(), "Lyle Irving")).toBe("Lyle Irving, 128,400 km, Toyota Hilux SR5 2021");
    expect(headLine(hilux({ motorised: false }), null)).toBe("Toyota Hilux SR5 2021");
  });
});

describe("where it stands", () => {
  it("says each renewal as a word in its state, with its date and who it's with", () => {
    const rows = standsRows(hilux({ regoDays: 25 }), POLICIES, LOGS, TODAY, 30);
    const rego = rows.find((r) => r.key === "rego")!;
    expect(rego.word).toEqual({ word: "Due in 25 days", tone: "look" });
    expect(rego.line).toBe("12 Nov 2026, Transport for NSW");
    const ins = rows.find((r) => r.key === "insurance")!;
    expect(ins.word).toEqual({ word: "Current", tone: "good" });
    expect(ins.line).toBe("To 7 Mar 2027, NRMA, comprehensive");
  });

  it("says Not set for a renewal nobody entered, never a date", () => {
    expect(renewalWord(null, 30)).toEqual({ word: "Not set", tone: "info" });
    expect(renewalWord(-4, 30)).toEqual({ word: "4 days overdue", tone: "wrong" });
  });

  it("says the service in grey while it's fine, and where the odometer was read", () => {
    const rows = standsRows(hilux(), [], LOGS, TODAY, 30);
    expect(rows.find((r) => r.key === "service")).toMatchObject({ word: { word: "In 1,800 km or in 73 days", tone: "info" }, line: "Due at 130,200 km or by 30 Dec 2026" });
    expect(rows.find((r) => r.key === "odo")).toMatchObject({ word: { word: "128,400 km" }, line: "Read day 2, from a fuel docket" });
  });
});

describe("Latest", () => {
  it("is one row of each kind, the newest of each", () => {
    const rows = latestRows(LOGS, POLICIES, { f1: 11.8 });
    expect(rows.map((r) => [r.label, r.name])).toEqual([
      ["Issue", "Aircon blowing warm"],
      ["Fuel", "68.2 litres, $141.20"],
      ["Kilometres", "127,100 km"],
      ["Service", "Logbook service, 120,000 km"],
      ["Renewal", "Insurance renewed to 7 Mar 2027"],
    ]);
    expect(rows[0].line).toBe("Lyle Irving, day 3, at 128,210 km");
    expect(rows[1].line).toBe("Ampol Botany, day 2, 11.8 L/100 km, company card");
    expect(rows[4].opens).toEqual({ renewal: "insurance" });
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
