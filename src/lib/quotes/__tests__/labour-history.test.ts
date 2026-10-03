import { labourAdvice, MIN_JOBS, sampleOf, typicalLabour, workKindOf, type LabourSample } from "../labour-history";

/* Isaac, 2026-10-04: "it should only show when enough jobs have run through
   for it to say (you typically use 24hrs labour for this type of work)…
   recommendation comes from orgs own history" */

const samples = (kind: LabourSample["kind"], hours: number[]): LabourSample[] => hours.map((h, i) => ({ job: `${kind}-${i}`, kind, personHours: h }));

describe("the business's own labour history", () => {
  it("tells the kind of work from the category and the words", () => {
    expect(workKindOf("1 Pax - 8hrs Paper Filters Required ANNUAL MAINTENANCE SERVICE", null)).toBe("maintenance");
    expect(workKindOf("Supply and installation of Mitsubishi Electric VRF 40kw PUHY-P400YNW", "Install")).toBe("vrf");
    expect(workKindOf("12.5KW Mitsubishi Electric VRF outdoor (PUMY-SP125VKMD)", "Install")).toBe("vrf");
    expect(workKindOf("Supply and install mits elec 10kw multi outdoor 3 x 2.5kw bulkhead indoors", "Install")).toBe("ducted");
    expect(workKindOf("Mits Elec 7kw multi outdoor, 5kw high wall to living", "Install")).toBe("multi");
    expect(workKindOf("Supply and install a 3.5kw high wall", "Install")).toBe("split");
    expect(workKindOf("Unit not cooling", "Service Call")).toBe("service");
    expect(workKindOf("Supply and install", null)).toBeNull();
  });

  it("a past job is a sample only when its brief states its labour", () => {
    expect(sampleOf("3256", "Mits Elec 7kw multi outdoor\n3 x pax for 1 day\nDave for 4 hrs for patching following day", "Install")).toEqual({
      job: "3256",
      kind: "multi",
      personHours: 28,
    });
    expect(sampleOf("3292", "Mits Elec 5.2kw multi outdoor, two heads", "Install")).toBeNull();
  });

  it(`says nothing until there are ${MIN_JOBS} of the same kind, then the middle of them`, () => {
    expect(typicalLabour(samples("multi", [16, 24, 28, 32]), "multi")).toBeNull();
    expect(typicalLabour([...samples("multi", [16, 24, 28, 32]), ...samples("split", [12])], "multi")).toBeNull();
    expect(typicalLabour(samples("multi", [16, 24, 28, 32, 40]), "multi")).toEqual({
      kind: "multi",
      hours: 28,
      jobs: 5,
      words: "You typically use 28 hrs labour for a multi-split (5 of your jobs).",
    });
  });

  it("the brief first, then the history, else nothing — never a rule of thumb", () => {
    const history = samples("multi", [16, 24, 28, 32, 40]);
    expect(labourAdvice("4 guys x 3 days", "multi", history)).toMatchObject({ from: "brief", labour: { personHours: 96 } });
    expect(labourAdvice("Five heads in a heritage apartment", "multi", history)).toMatchObject({ from: "history", typical: { hours: 28 } });
    expect(labourAdvice("Five heads in a heritage apartment", "vrf", history)).toEqual({ from: "none" });
    expect(labourAdvice("Five heads", null, history)).toEqual({ from: "none" });
  });
});
