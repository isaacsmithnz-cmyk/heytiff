import { mapPlaceToParts, type PlaceComponent } from "../map-place";

/* Real Australian addresses, in the shape Google actually returns them.

   The fixtures are the test. Every one of these is a case that has a wrong
   answer available: a unit whose number could be dropped, a rural property
   with no street number, a territory that is not a state, a component list in
   a different order. What is being pinned is that a part we can't read leaves
   an EMPTY BOX rather than a guess — a half-filled form the person finishes is
   honest; a confidently wrong postcode is not. */

const c = (types: string[], longText: string, shortText = longText): PlaceComponent => ({
  longText,
  shortText,
  types,
});

/** 12 Trade Street, Ringwood VIC 3134 — the ordinary case. */
const RINGWOOD: PlaceComponent[] = [
  c(["street_number"], "12"),
  c(["route"], "Trade Street", "Trade St"),
  c(["locality", "political"], "Ringwood"),
  c(["administrative_area_level_1", "political"], "Victoria", "VIC"),
  c(["country", "political"], "Australia", "AU"),
  c(["postal_code"], "3134"),
];

describe("an ordinary street address", () => {
  it("splits into the four boxes the forms hold", () => {
    expect(mapPlaceToParts(RINGWOOD)).toEqual({
      // the SHORT route — "Trade St" is how it's written on an invoice, and
      // what fits a one-line field
      address: "12 Trade St",
      suburb: "Ringwood",
      state: "VIC",
      postcode: "3134",
    });
  });

  it("reads by type, not by position", () => {
    const shuffled = [...RINGWOOD].reverse();
    expect(mapPlaceToParts(shuffled)).toEqual(mapPlaceToParts(RINGWOOD));
  });
});

describe("a unit", () => {
  /* Unit 5, 12 Trade Street. The subpremise is the business's OWN address —
     drop it and the org's street line is the building's, which is the kind of
     wrong that only shows up on a delivery that never arrives. */
  it("keeps the unit number, written the Australian way", () => {
    const parts = mapPlaceToParts([c(["subpremise"], "5"), ...RINGWOOD]);
    expect(parts.address).toBe("5/12 Trade St");
    expect(parts.suburb).toBe("Ringwood");
  });

  it("still works when the unit is alphanumeric", () => {
    expect(mapPlaceToParts([c(["subpremise"], "B2"), ...RINGWOOD]).address).toBe("B2/12 Trade St");
  });
});

describe("what a lookup can fail to give", () => {
  it("a rural property with no street number keeps the road", () => {
    const rural: PlaceComponent[] = [
      c(["route"], "Snowy Mountains Highway", "Snowy Mountains Hwy"),
      c(["locality", "political"], "Adaminaby"),
      c(["administrative_area_level_1", "political"], "New South Wales", "NSW"),
      c(["postal_code"], "2629"),
    ];
    expect(mapPlaceToParts(rural)).toEqual({
      address: "Snowy Mountains Hwy",
      suburb: "Adaminaby",
      state: "NSW",
      postcode: "2629",
    });
  });

  it("falls back to the sublocality when there is no locality", () => {
    const inner: PlaceComponent[] = [
      c(["street_number"], "1"),
      c(["route"], "Bourke Street", "Bourke St"),
      c(["sublocality", "sublocality_level_1", "political"], "Docklands"),
      c(["administrative_area_level_1", "political"], "Victoria", "VIC"),
      c(["postal_code"], "3008"),
    ];
    expect(mapPlaceToParts(inner).suburb).toBe("Docklands");
  });

  it("leaves the postcode empty rather than inventing one", () => {
    const noPost = RINGWOOD.filter((x) => !x.types?.includes("postal_code"));
    expect(mapPlaceToParts(noPost).postcode).toBe("");
  });

  it("answers an empty or missing component list with four empty boxes", () => {
    const empty = { address: "", suburb: "", state: "", postcode: "" };
    expect(mapPlaceToParts([])).toEqual(empty);
    expect(mapPlaceToParts(null)).toEqual(empty);
    expect(mapPlaceToParts(undefined)).toEqual(empty);
  });

  it("survives a component with no text at all", () => {
    expect(mapPlaceToParts([{ types: ["route"] }, ...RINGWOOD]).address).toBe("12 Trade St");
  });

  it("uses the long text when a component has no short form", () => {
    const longOnly: PlaceComponent[] = [
      { longText: "12", types: ["street_number"] },
      { longText: "Trade Street", types: ["route"] },
    ];
    expect(mapPlaceToParts(longOnly).address).toBe("12 Trade Street");
  });
});

describe("the state, which also picks the public-holiday calendar", () => {
  it("takes the short code the State select can actually show", () => {
    for (const [long, short] of [
      ["New South Wales", "NSW"],
      ["Queensland", "QLD"],
      ["South Australia", "SA"],
      ["Western Australia", "WA"],
      ["Tasmania", "TAS"],
    ] as const) {
      const parts = mapPlaceToParts([c(["administrative_area_level_1"], long, short)]);
      expect(parts.state).toBe(short);
    }
  });

  /* The territories are the interesting half: ACT and NT ARE in the select, so
     they must come through — it is everything else that must not. */
  it("accepts both territories", () => {
    const act = [
      c(["street_number"], "2"),
      c(["route"], "King George Terrace", "King George Tce"),
      c(["locality"], "Parkes"),
      c(["administrative_area_level_1"], "Australian Capital Territory", "ACT"),
      c(["postal_code"], "2600"),
    ];
    expect(mapPlaceToParts(act)).toEqual({
      address: "2 King George Tce",
      suburb: "Parkes",
      state: "ACT",
      postcode: "2600",
    });
    expect(
      mapPlaceToParts([c(["administrative_area_level_1"], "Northern Territory", "NT")]).state
    ).toBe("NT");
  });

  /* Australia's external territories answer administrative_area_level_1 with
     something the eight-item select has no entry for. Blank beats a value the
     control cannot display — and this field feeds the holiday calendar, so a
     junk state is not cosmetic. */
  it("blanks an answer that is not one of the eight", () => {
    for (const odd of ["Christmas Island", "Norfolk Island", "Jervis Bay Territory", "CI"]) {
      expect(mapPlaceToParts([c(["administrative_area_level_1"], odd)]).state).toBe("");
    }
  });

  it("blanks an overseas state that slipped past the AU region filter", () => {
    expect(
      mapPlaceToParts([c(["administrative_area_level_1"], "Auckland", "AUK")]).state
    ).toBe("");
    expect(
      mapPlaceToParts([c(["administrative_area_level_1"], "California", "CA")]).state
    ).toBe("");
  });

  it("takes a lower-case code as the code it is", () => {
    expect(mapPlaceToParts([c(["administrative_area_level_1"], "Victoria", "vic")]).state).toBe(
      "VIC"
    );
  });

  it("leaves the state empty when Google didn't say", () => {
    const noState = RINGWOOD.filter(
      (x) => !x.types?.includes("administrative_area_level_1")
    );
    expect(mapPlaceToParts(noState).state).toBe("");
  });
});
