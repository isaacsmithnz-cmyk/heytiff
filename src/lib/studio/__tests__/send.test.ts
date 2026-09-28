import {
  AUDIENCE_PARTS,
  LEGACY_LINK_SCOPE,
  audienceOf,
  linkFloors,
  linkScopeOf,
  notCarried,
  parseLinkScope,
  sameLinkScope,
  sectionsOf,
  type SendPart,
} from "../send";

const set = (...p: SendPart[]) => new Set<SendPart>(p);

describe("what each way out can carry", () => {
  it("never puts the picklist or the other options on the customer's link", () => {
    expect(notCarried("picklist", "link")).toBe("Not on the link");
    expect(notCarried("options", "link")).toBe("PDF only");
  });

  it("never puts the simulation on paper", () => {
    expect(notCarried("sim", "pdf")).toBe("Link only");
  });

  it("carries the rest either way", () => {
    for (const p of ["figures", "systems", "lines", "plans"] as const) {
      expect(notCarried(p, "pdf")).toBeNull();
      expect(notCarried(p, "link")).toBeNull();
    }
  });
});

describe("who it is for", () => {
  it("the customer gets the design without the materials", () => {
    expect(AUDIENCE_PARTS.customer).not.toContain("picklist");
    expect(AUDIENCE_PARTS.customer).not.toContain("lines");
  });

  it("the crew keeps the heat loads, to check against the site", () => {
    expect(AUDIENCE_PARTS.crew).toContain("figures");
    expect(AUDIENCE_PARTS.crew).toContain("picklist");
  });

  it("reads a preset as chosen whatever the hidden rows hold", () => {
    const pdf = (p: SendPart) => notCarried(p, "pdf") === null;
    // the customer preset carries the simulation, which paper cannot show
    expect(audienceOf(set("figures", "systems", "plans"), pdf)).toBe("customer");
    expect(audienceOf(set("figures", "systems", "plans", "sim"), pdf)).toBe("customer");
    expect(audienceOf(set("figures", "systems"), pdf)).toBeNull();
  });

  it("turns ticks into the sheet's sections", () => {
    expect(sectionsOf(set("figures", "picklist"))).toEqual({
      figures: true,
      systems: false,
      lines: false,
      picklist: true,
    });
  });
});

describe("the live link's scope", () => {
  it("a link made before scopes shows what it always did", () => {
    expect(parseLinkScope(null)).toEqual(LEGACY_LINK_SCOPE);
    expect(parseLinkScope("junk")).toEqual(LEGACY_LINK_SCOPE);
    expect(LEGACY_LINK_SCOPE.parts).not.toContain("plans");
  });

  it("drops anything the link cannot carry, whatever the browser sent", () => {
    const s = parseLinkScope({ parts: ["picklist", "options", "figures", "evil"], hiddenFloorIds: [1, "f2"] });
    expect(s).toEqual({ parts: ["figures"], hiddenFloorIds: ["f2"] });
  });

  it("stores the floors left out, so a floor drawn later shows up", () => {
    const scope = linkScopeOf(set("plans"), new Set(["f1"]), ["f1", "f2"]);
    expect(scope.hiddenFloorIds).toEqual(["f2"]);
    const floors = [
      { id: "f3", level: 2 },
      { id: "f2", level: 1 },
      { id: "f1", level: 0 },
    ];
    expect(linkFloors(scope, floors).map((f) => f.id)).toEqual(["f1", "f3"]);
  });

  it("shows no plans unless plans are ticked", () => {
    expect(linkFloors(LEGACY_LINK_SCOPE, [{ id: "f1", level: 0 }])).toEqual([]);
  });

  it("compares scopes by what they show", () => {
    const a = linkScopeOf(set("sim", "figures"), new Set(), []);
    const b = parseLinkScope({ parts: ["figures", "sim"] });
    expect(sameLinkScope(a, b)).toBe(true);
    expect(sameLinkScope(a, LEGACY_LINK_SCOPE)).toBe(false);
  });
});
