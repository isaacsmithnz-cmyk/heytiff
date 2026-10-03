import { overriddenDays, ourSessions, sameName } from "../job-check-ins";

const people = new Map([
  ["u-luke", { name: "Luke Ingold", sm8StaffUuid: "sm8-luke" }],
  ["u-new", { name: "Sam New", sm8StaffUuid: null }],
]);

describe("check-ins pressed on the card", () => {
  it("become sessions in the account's own clock, under the ServiceM8 person they are", () => {
    const s = ourSessions(
      [{ id: "1", userId: "u-luke", inAt: "2026-09-30T21:32:00Z", outAt: "2026-10-01T06:05:00Z" }],
      people,
      "Australia/Sydney",
      new Date("2026-10-01T08:00:00Z")
    );
    expect(s).toEqual([{ uuid: "hey:1", staffId: "sm8-luke", start: "2026-10-01 07:32", end: "2026-10-01 16:05", live: false }]);
  });

  it("someone not in ServiceM8 appears under their own id", () => {
    const [s] = ourSessions([{ id: "2", userId: "u-new", inAt: "2026-09-30T21:00:00Z", outAt: null }], people, "Australia/Sydney", new Date("2026-09-30T23:00:00Z"));
    expect(s).toMatchObject({ staffId: "hey:u-new", start: "2026-10-01 07:00", end: "2026-10-01 09:00", live: true });
  });

  it("names the person-days ServiceM8's sessions give way on", () => {
    const s = ourSessions([{ id: "1", userId: "u-luke", inAt: "2026-09-30T21:32:00Z", outAt: "2026-10-01T06:05:00Z" }], people, "Australia/Sydney", new Date());
    expect([...overriddenDays(s)]).toEqual(["2026-10-01|sm8-luke"]);
  });

  it("matches a name the way two people would", () => {
    expect(sameName("Luke  Ingold", "luke ingold")).toBe(true);
    expect(sameName("Alex L.", "alex l")).toBe(true);
    expect(sameName("Alex L", "Alex B")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});
