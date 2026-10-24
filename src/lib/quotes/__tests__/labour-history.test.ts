import { workKindOf } from "../labour-history";

/* Isaac, 2026-10-04: "it should only show when enough jobs have run through
   for it to say (you typically use 24hrs labour for this type of work)";
   2026-10-05: from the post-job review only, from 3 reviewed jobs */


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


});
