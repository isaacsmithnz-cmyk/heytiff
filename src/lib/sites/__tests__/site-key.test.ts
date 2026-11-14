import { siteOf, siteSearch, typedSuburb, unitWords } from "../site-key";

/* Addresses as ServiceM8 holds them, typed by hand. */

describe("one building, however it was typed", () => {
  const building = siteOf("106 Kirribilli Avenue\nKirribilli,  2061", "Kirribilli");
  it("keys the building on its number, street and suburb", () => {
    expect(building).toEqual({ key: "106|kirribilli|ave|kirribilli", unit: null });
  });
  it("leaves the unit off the building and keeps it apart", () => {
    expect(siteOf("2/106 Kirribilli Avenue\nKirribilli NSW 2061", "Kirribilli")).toEqual({ key: building!.key, unit: "2" });
    expect(siteOf("Unit 2, 106 Kirribilli Ave, Kirribilli NSW 2061")).toEqual({ key: building!.key, unit: "2" });
  });
  it("takes Ave and Avenue as one, and the state and postcode as nothing", () => {
    expect(siteOf("106 Kirribilli Ave, Kirribilli")?.key).toBe(building!.key);
    expect(siteOf("106 Kirribilli Av\nKirribilli NSW 2061")?.key).toBe(building!.key);
  });
  it("is another building at another number or in another suburb", () => {
    expect(siteOf("108 Kirribilli Avenue\nKirribilli NSW 2061")?.key).not.toBe(building!.key);
    expect(siteOf("106 Kirribilli Avenue\nMilsons Point NSW 2061")?.key).not.toBe(building!.key);
  });
});

describe("the suburb", () => {
  it("is read after the street, on its own line or after a comma", () => {
    expect(typedSuburb("17/23 Bowden St\nAlexandria\n2015")).toBe("alexandria");
    expect(typedSuburb("u18/196-202 Wyndham Street, Alexandria NSW, Australia")).toBe("alexandria");
    expect(typedSuburb("3/48 Towns Road, Vaucluse, NSW, 2030 ")).toBe("vaucluse");
    expect(typedSuburb("21/1122 Pittwater Rd, Collaroy, 2097")).toBe("collaroy");
  });
  it("falls back to the geocoded city when the address gives none", () => {
    expect(siteOf("4/105 avenue Rd mosman", "Mosman")).toEqual({ key: "105|avenue|rd|mosman", unit: "4" });
    expect(siteOf("4/105 Avenue Road\nMosman NSW 2088")).toEqual({ key: "105|avenue|rd|mosman", unit: "4" });
  });
  it("is no site at all without one", () => {
    expect(siteOf("4/105 avenue Rd mosman")).toBeNull();
  });
});

describe("units", () => {
  it("reads the shapes they come in", () => {
    expect(siteOf("u18/196-202 Wyndham Street, Alexandria NSW")).toEqual({ key: "196-202|wyndham|st|alexandria", unit: "18" });
    expect(siteOf("1a/63 Kirribilli Ave\nKirribilli NSW 2061")?.unit).toBe("1a");
    expect(siteOf("b308/87 Bay St\nGlebe NSW 2037")).toEqual({ key: "87|bay|st|glebe", unit: "b308" });
  });
  it("names one on the page", () => {
    expect(unitWords("2")).toBe("Unit 2");
    expect(unitWords("1a")).toBe("Unit 1A");
  });
});

it("gives nothing for an address that isn't a street", () => {
  expect(siteOf("")).toBeNull();
  expect(siteOf("Sydney Airport", "Mascot")).toBeNull();
});

it("searches a street's number and its longest word", () => {
  expect(siteSearch("106|kirribilli|ave|kirribilli")).toEqual({ number: "106", word: "kirribilli" });
  expect(siteSearch("196-202|wyndham|st|alexandria")).toEqual({ number: "196", word: "wyndham" });
});
