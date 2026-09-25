/* The Home calendar's items: rows in, items out. What matters here is what a
   person reads (the words and the doors) and the three places a wrong answer
   would be silent: a sold vehicle, a vehicle with no status, and an admin
   date the calendar calls late when the bell does not (or the other way). */

import {
  companyItems,
  companyWindow,
  credentialItems,
  eventItems,
  holidayItems,
  noticeItems,
  schoolItems,
  vehicleItems,
  wallClock,
  type CalendarEventRow,
  type CompanyRows,
  type VehicleExpiryRow,
} from "../items";
import { expiryDue } from "@/lib/expiry-due";
import type { OrgCredential } from "@/lib/org/credentials";

const TODAY = "2026-09-25";

const van = (over: Partial<VehicleExpiryRow> = {}): VehicleExpiryRow => ({
  id: "v1",
  name: "Spare van",
  plate: "CY14FE",
  status: "active",
  regoExpiry: "2026-10-20",
  insuranceExpiry: "2026-12-11",
  ctpExpiry: "2026-10-20",
  ...over,
});

const cred = (over: Partial<OrgCredential> = {}): OrgCredential => ({
  id: "c1",
  kind: "insurance",
  name: "Public liability",
  number: "PL-1",
  issuer: "QBE Insurance (Australia) Ltd",
  expiryDate: "2026-11-10",
  color: null,
  ...over,
});

const event = (over: Partial<CalendarEventRow> = {}): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Toolbox talk",
  startsOn: "2026-10-01",
  endsOn: "2026-10-01",
  startsAt: "06:45:00",
  endsAt: "07:15:00",
  location: "The yard",
  audience: "Everyone",
  note: "This month: working at heights",
  seriesId: null,
  repeat: null,
  createdBy: null,
  createdAt: null,
  ...over,
});

describe("the window", () => {
  it("runs from the 1st of this month to the last day of the 11th month after", () => {
    expect(companyWindow("2026-09-25")).toEqual({ windowStart: "2026-09-01", windowEnd: "2027-08-31" });
    expect(companyWindow("2026-01-31")).toEqual({ windowStart: "2026-01-01", windowEnd: "2026-12-31" });
    expect(companyWindow("2026-12-01")).toEqual({ windowStart: "2026-12-01", windowEnd: "2027-11-30" });
    // February's end, leap and not
    expect(companyWindow("2027-03-05")).toEqual({ windowStart: "2027-03-01", windowEnd: "2028-02-29" });
    expect(companyWindow("2026-03-05")).toEqual({ windowStart: "2026-03-01", windowEnd: "2027-02-28" });
  });

  it("is no window at all for something that is not a day", () => {
    expect(companyWindow("")).toBeNull();
    expect(companyWindow("2026-13-01")).toBeNull();
    expect(companyWindow("25/09/2026")).toBeNull();
  });
});

describe("vehicles", () => {
  it("makes one item per renewal date, named the way the handoff names them", () => {
    const items = vehicleItems([van()], TODAY, 30);
    expect(items.map((x) => [x.id, x.title, x.monthTitle, x.monthMeta, x.start, x.end])).toEqual([
      ["veh:v1:rego", "Spare van, CY14FE rego", "Spare van rego", "CY14FE", "2026-10-20", "2026-10-20"],
      ["veh:v1:insurance", "Spare van, CY14FE insurance", "Spare van insurance", "CY14FE", "2026-12-11", "2026-12-11"],
      ["veh:v1:ctp", "Spare van, CY14FE green slip", "Spare van green slip", "CY14FE", "2026-10-20", "2026-10-20"],
    ]);
    expect(items.every((x) => x.cat === "admin")).toBe(true);
  });

  it("gives a date nobody entered no item", () => {
    const items = vehicleItems([van({ insuranceExpiry: null, ctpExpiry: "" })], TODAY, 30);
    expect(items.map((x) => x.id)).toEqual(["veh:v1:rego"]);
  });

  it("leaves a sold vehicle out and keeps one whose status is NULL (the neq trap)", () => {
    const items = vehicleItems(
      [van({ id: "sold", status: "sold" }), van({ id: "nul", status: null }), van({ id: "act" })],
      TODAY,
      30,
    );
    const ids = new Set(items.map((x) => x.id.split(":")[1]));
    expect([...ids].sort()).toEqual(["act", "nul"]);
  });

  it("is late exactly when the bell says so, at the org's window", () => {
    for (const warnDays of [14, 30]) {
      for (const date of ["2026-09-17", "2026-09-24", "2026-09-25", "2026-10-09", "2026-10-20", "2027-01-22"]) {
        const [item] = vehicleItems([van({ regoExpiry: date, insuranceExpiry: null, ctpExpiry: null })], TODAY, warnDays);
        expect([date, item.overdue]).toEqual([date, expiryDue(date, TODAY, warnDays)!.state === "bad"]);
      }
    }
  });

  it("says what it is, where it came from, and opens the renewal", () => {
    const [due] = vehicleItems([van({ insuranceExpiry: null, ctpExpiry: null })], TODAY, 30);
    expect(due).toMatchObject({
      sub: "From Assets.",
      description: "The rego on CY14FE runs out on Tue 20 Oct.",
      facts: [
        ["Vehicle", "Spare van, CY14FE"],
        ["Rego", "Runs out Tue 20 Oct 2026"],
        ["From", "Assets"],
      ],
      action: { label: "Renew rego", href: "/dashboard/assets?v=v1&screen=rego" },
      overdue: false,
    });

    const [late] = vehicleItems([van({ regoExpiry: null, insuranceExpiry: null, ctpExpiry: "2026-09-17" })], TODAY, 30);
    expect(late).toMatchObject({
      sub: "Overdue. From Assets.",
      description: "The green slip on CY14FE ran out on Thu 17 Sept.",
      facts: [
        ["Vehicle", "Spare van, CY14FE"],
        ["Green slip", "Ran out Thu 17 Sept 2026"],
        ["From", "Assets"],
      ],
      action: { label: "Renew green slip", href: "/dashboard/assets?v=v1&screen=ctp" },
      overdue: true,
    });
  });

  it("names a vehicle by whatever it has", () => {
    const only = (v: Partial<VehicleExpiryRow>) =>
      vehicleItems([van({ insuranceExpiry: null, ctpExpiry: null, ...v })], TODAY, 30)[0];
    expect(only({ name: null })).toMatchObject({ title: "CY14FE rego", monthTitle: "CY14FE rego", monthMeta: null });
    expect(only({ plate: "  " })).toMatchObject({
      title: "Spare van rego",
      monthMeta: null,
      description: "The rego on Spare van runs out on Tue 20 Oct.",
    });
    expect(only({ name: null, plate: null }).title).toBe("Unnamed vehicle rego");
  });
});

describe("the business's own papers", () => {
  it("names the cover, the insurer and the day, and opens the credentials", () => {
    const [x] = credentialItems([cred()], TODAY, 30);
    expect(x).toMatchObject({
      id: "cred:c1",
      cat: "admin",
      start: "2026-11-10",
      end: "2026-11-10",
      title: "Public liability insurance",
      monthTitle: "Public liability",
      sub: "QBE Insurance (Australia) Ltd. From Admin.",
      description: "Your public liability cover with QBE Insurance (Australia) Ltd runs out on Tue 10 Nov.",
      facts: [
        ["Insurer", "QBE Insurance (Australia) Ltd"],
        ["Runs out", "Tue 10 Nov 2026"],
        ["From", "Admin"],
      ],
      action: { label: "Renew", href: "/dashboard/admin/organization?sec=credentials" },
      overdue: false,
    });
  });

  it("keeps a licence's capitals, and says when it has run out", () => {
    const [x] = credentialItems(
      [cred({ kind: "licence", name: "ARC authorisation", issuer: "Australian Refrigeration Council", expiryDate: "2026-09-01" })],
      TODAY,
      30,
    );
    expect(x).toMatchObject({
      title: "ARC authorisation",
      sub: "Overdue. Australian Refrigeration Council. From Admin.",
      description: "Your ARC authorisation from Australian Refrigeration Council ran out on Tue 1 Sept.",
      facts: [
        ["Issuer", "Australian Refrigeration Council"],
        ["Ran out", "Tue 1 Sept 2026"],
        ["From", "Admin"],
      ],
      overdue: true,
    });
  });

  it("does not say insurance twice, and does without an insurer", () => {
    const [x] = credentialItems([cred({ name: "Motor insurance", issuer: null })], TODAY, 30);
    expect(x).toMatchObject({
      title: "Motor insurance",
      sub: "From Admin.",
      description: "Your motor insurance runs out on Tue 10 Nov.",
      facts: [
        ["Runs out", "Tue 10 Nov 2026"],
        ["From", "Admin"],
      ],
    });
  });

  it("gives a card with no expiry, or no name, no item", () => {
    expect(credentialItems([cred({ expiryDate: null }), cred({ id: "c2", name: "  " })], TODAY, 30)).toEqual([]);
  });

  it("is late exactly when the bell says so", () => {
    for (const warnDays of [14, 30]) {
      for (const date of ["2026-09-24", "2026-09-25", "2026-10-09", "2026-10-26"]) {
        const [x] = credentialItems([cred({ expiryDate: date })], TODAY, warnDays);
        expect([date, x.overdue]).toEqual([date, expiryDue(date, TODAY, warnDays)!.state === "bad"]);
      }
    }
  });
});

describe("holidays", () => {
  it("makes a public holiday a one-day item keyed by its day", () => {
    expect(holidayItems([{ date: "2026-10-05", name: "Labour Day" }])).toEqual([
      { id: "ph:2026-10-05", cat: "hol", start: "2026-10-05", end: "2026-10-05", title: "Labour Day" },
    ]);
  });

  it("drops a row with no day or no name rather than drawing it somewhere", () => {
    expect(holidayItems([{ date: "", name: "Labour Day" }, { date: "2026-10-05", name: " " }])).toEqual([]);
  });

  it("carries a school break's range, season and the day students go back", () => {
    expect(
      schoolItems([
        { season: "spring", startsOn: "2026-09-28", endsOn: "2026-10-09", studentsBack: "2026-10-13" },
        { season: "Summer", startsOn: "2027-12-21", endsOn: "2028-01-28", studentsBack: null },
        { season: "winter", startsOn: "2027-07-16", endsOn: "2027-07-05", studentsBack: null },
      ]),
    ).toEqual([
      {
        id: "sch:2026-09-28",
        cat: "school",
        start: "2026-09-28",
        end: "2026-10-09",
        title: "School holidays",
        back: "2026-10-13",
        season: "spring",
      },
      {
        id: "sch:2027-12-21",
        cat: "school",
        start: "2027-12-21",
        end: "2028-01-28",
        title: "School holidays",
        back: null,
        season: "summer",
      },
    ]);
  });
});

describe("events", () => {
  it("makes a company event editable, with its place, people and hours", () => {
    const [x] = eventItems([event({ createdBy: "s1", createdAt: "2026-09-24T02:00:00Z" })], new Map([["s1", "Isaac"]]));
    expect(x).toEqual({
      id: "ev:e1",
      cat: "event",
      start: "2026-10-01",
      end: "2026-10-01",
      title: "Toolbox talk",
      time: "06:45",
      timeEnd: "07:15",
      sub: "The yard. This month: working at heights.",
      description: "This month: working at heights.",
      facts: [
        ["Where", "The yard"],
        ["Who", "Everyone"],
        ["Added", "Isaac, Thu 24 Sept"],
      ],
      action: "edit",
      shutdown: false,
      seriesId: null,
      repeat: null,
    });
  });

  it("reads the day it was added on the yard's clock, not UTC's", () => {
    // 22:00 UTC on the 23rd is 8am on the 24th in Sydney
    const [x] = eventItems([event({ createdAt: "2026-09-23T22:00:00Z" })]);
    expect(x.facts).toContainEqual(["Added", "Thu 24 Sept"]);
  });

  it("gives a shutdown its range and no hours", () => {
    const [x] = eventItems([
      event({
        kind: "shutdown",
        title: "Christmas shutdown",
        startsOn: "2026-12-23",
        endsOn: "2027-01-08",
        startsAt: null,
        endsAt: null,
        location: null,
        audience: null,
        note: null,
      }),
    ]);
    expect(x).toMatchObject({
      start: "2026-12-23",
      end: "2027-01-08",
      shutdown: true,
      time: null,
      timeEnd: null,
      sub: null,
      description: null,
      facts: [],
    });
  });

  it("keeps a series' id and rule for the Repeats line", () => {
    const rule = { every: "month", day: "thu", nth: 1 };
    const [x] = eventItems([event({ seriesId: "s-1", repeat: rule })]);
    expect(x).toMatchObject({ seriesId: "s-1", repeat: rule });
  });

  it("makes a notice's event read-only, with the board as its door", () => {
    expect(
      noticeItems([{ id: "n1", title: "Christmas party", date: "2026-12-11", time: "18:00:00", location: "The Rocks" }]),
    ).toEqual([
      {
        id: "nt:n1",
        cat: "event",
        start: "2026-12-11",
        end: "2026-12-11",
        title: "Christmas party",
        time: "18:00",
        sub: "The Rocks.",
        facts: [
          ["Where", "The Rocks"],
          ["From", "Notices"],
        ],
        action: { label: "Open notice", href: "/dashboard/notices" },
      },
    ]);
  });

  it("reads a wall-clock time and nothing else", () => {
    expect(wallClock("07:30")).toBe("07:30");
    expect(wallClock("7:30")).toBe("07:30");
    expect(wallClock("07:30:00")).toBe("07:30");
    expect(wallClock("23:59:59.5")).toBe("23:59");
    for (const v of [null, "", "24:00", "07:60", "7.30", "7:30 am"]) expect(wallClock(v)).toBeNull();
  });
});

describe("all of it", () => {
  const rows = (over: Partial<CompanyRows> = {}): CompanyRows => ({
    holidays: [],
    school: [],
    events: [],
    notices: [],
    vehicles: [],
    credentials: [],
    ...over,
  });
  const at = { today: TODAY, windowEnd: "2027-08-31", warnDays: 30 };

  it("keeps an admin date that ran out before the window, and drops one after it", () => {
    const items = companyItems(
      rows({
        vehicles: [van({ regoExpiry: "2026-06-30", insuranceExpiry: "2027-08-31", ctpExpiry: "2027-09-01" })],
      }),
      at,
    );
    expect(items.map((x) => [x.id, x.overdue])).toEqual([
      ["veh:v1:rego", true],
      ["veh:v1:insurance", false],
    ]);
  });

  it("brings every source together, each under its own namespace", () => {
    const items = companyItems(
      rows({
        holidays: [{ date: "2026-10-05", name: "Labour Day" }],
        school: [{ season: "spring", startsOn: "2026-09-28", endsOn: "2026-10-09", studentsBack: "2026-10-13" }],
        events: [event()],
        notices: [{ id: "n1", title: "Christmas party", date: "2026-12-11", time: null, location: null }],
        vehicles: [van({ insuranceExpiry: null, ctpExpiry: null })],
        credentials: [cred()],
      }),
      { ...at, names: new Map() },
    );
    expect(items.map((x) => x.id)).toEqual(["ph:2026-10-05", "sch:2026-09-28", "ev:e1", "nt:n1", "veh:v1:rego", "cred:c1"]);
  });
});
