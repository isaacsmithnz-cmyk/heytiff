import { sniff } from "../sniff";

/* The sieve in front of the router.

   Every case here is a real sentence someone would say into a field on this
   app — gate codes, roof access, a fault, a job for Luke. The point of the
   file is the asymmetry: a wrong YES costs one wasted routing call, a wrong
   NO is invisible to everyone forever. So the misses are what these guard. */

const STAFF = ["Luke", "Dane", "Priya", "Isaac"];

describe("things that must never cost a routing call", () => {
  it.each([
    ["gate code 4417"],
    ["Gate code changed to 4417"],
    ["Roof key is behind the front desk"],
    ["Ask for Priya"],
    ["north stair"],
    [""],
    ["   "],
  ])("stays quiet on %j", (text) => {
    expect(sniff(text, STAFF).actionable).toBe(false);
  });

  it("a long descriptive note with no ask in it is still quiet", () => {
    const text =
      "Plant room is on level 6, access via the north stair because the lift " +
      "does not go up to plant level, and the roof hatch is on the east side.";
    expect(sniff(text, STAFF).actionable).toBe(false);
  });

  it("describing work already done is not asking for work", () => {
    expect(sniff("Did a check on the belts and the filters this morning", STAFF).actionable).toBe(
      false
    );
  });

  it("a word that merely contains a verb doesn't count", () => {
    /* "recorder" contains "order", "recall" contains "call". Both turn up in
       HVAC notes and neither is a job for anybody. */
    const s = sniff("The recorder in the plant room needs no recall of data", []);
    expect(s.reasons.join(" ")).not.toMatch(/opens with/);
  });
});

describe("things that must always be offered", () => {
  it("the canonical note — a person, a job and a deadline", () => {
    const s = sniff(
      "Tell Luke he needs to order the grilles for Smith Street before Monday's visit",
      STAFF
    );
    expect(s.actionable).toBe(true);
    expect(s.reasons.some((r) => r.includes("Luke"))).toBe(true);
  });

  it("a bare imperative with a deadline", () => {
    expect(sniff("Order the new grilles before Friday", STAFF).actionable).toBe(true);
  });

  it("a fault that has happened before", () => {
    expect(
      sniff("The middle rooftop unit tripped again on Tuesday, third time now", STAFF).actionable
    ).toBe(true);
  });

  it("an obligation with no name attached", () => {
    expect(sniff("Someone needs to chase the supplier about the coil", []).actionable).toBe(true);
  });

  it("the roof-hatch case from the design deck", () => {
    expect(
      sniff("Roof hatch padlock is seized, Luke needs to bring bolt cutters before Monday", STAFF)
        .actionable
    ).toBe(true);
  });
});

describe("a named person is load-bearing", () => {
  it("a name plus any other signal is enough on its own", () => {
    /* One name, one fault word, and nothing else — under the two-signal bar
       on score alone, but a real person is named and that is the whole
       reason the feature exists. */
    const s = sniff("Dane says the compressor is faulty", STAFF);
    expect(s.actionable).toBe(true);
  });

  it("but only for people who actually exist here", () => {
    const s = sniff("Gandalf says the compressor is faulty", STAFF);
    expect(s.reasons.some((r) => r.includes("Gandalf"))).toBe(false);
  });

  it("an empty roster doesn't crash the sieve — it just loses a signal", () => {
    expect(() => sniff("Tell Luke to order the grilles", [])).not.toThrow();
    expect(sniff("Tell Luke to order the grilles", []).actionable).toBe(true);
  });
});

describe("the verdict is diagnosable", () => {
  it("says why, so a wrong call can be read rather than re-derived", () => {
    const s = sniff("Luke needs to order the grilles before Monday", STAFF);
    expect(s.reasons.length).toBeGreaterThanOrEqual(3);
    expect(s.score).toBeGreaterThan(0.6);
  });

  it("score is clamped to 1 no matter how many signals pile up", () => {
    const s = sniff(
      "Tell Luke he must order and replace the faulty leaking unit today, urgent, it tripped again",
      STAFF
    );
    expect(s.score).toBeLessThanOrEqual(1);
  });
});
