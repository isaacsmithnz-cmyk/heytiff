import { siteOf, siteSearch, typedSuburb, unitWords } from "../site-key";

/* Addresses as ServiceM8 holds them, typed by hand. */

describe("one building, however it was typed", () => {
  const building = siteOf("106 Exampleton Avenue\nExampleton,  2061", "Exampleton");
  it("keys the building on its number, street and suburb", () => {
    expect(building).toEqual({ key: "106|exampleton|ave|exampleton", unit: null });
  });
  it("leaves the unit off the building and keeps it apart", () => {
    expect(siteOf("2/106 Exampleton Avenue\nExampleton NSW 2061", "Exampleton")).toEqual({ key: building!.key, unit: "2" });
    expect(siteOf("Unit 2, 106 Exampleton Ave, Exampleton NSW 2061")).toEqual({ key: building!.key, unit: "2" });
  });
  it("takes Ave and Avenue as one, and the state and postcode as nothing", () => {
    expect(siteOf("106 Exampleton Ave, Exampleton")?.key).toBe(building!.key);
    expect(siteOf("106 Exampleton Av\nExampleton NSW 2061")?.key).toBe(building!.key);
  });
  it("is another building at another number or in another suburb", () => {
    expect(siteOf("108 Exampleton Avenue\nExampleton NSW 2061")?.key).not.toBe(building!.key);
    expect(siteOf("106 Exampleton Avenue\nMilsons Point NSW 2061")?.key).not.toBe(building!.key);
  });
});

describe("the suburb", () => {
  it("is read after the street, on its own line or after a comma", () => {
    expect(typedSuburb("17/23 Sample St\nExampleria\n2015")).toBe("exampleria");
    expect(typedSuburb("u18/196-202 Fabulum Street, Exampleria NSW, Australia")).toBe("exampleria");
    expect(typedSuburb("3/48 Phantom Road, Samplecluse, NSW, 2030 ")).toBe("samplecluse");
    expect(typedSuburb("21/1122 Madeup Rd, Fakeroy, 2097")).toBe("fakeroy");
  });
  it("falls back to the geocoded city when the address gives none", () => {
    expect(siteOf("4/17 avenue Rd sampleton", "Sampleton")).toEqual({ key: "17|avenue|rd|sampleton", unit: "4" });
    expect(siteOf("4/17 Avenue Road\nSampleton NSW 2088")).toEqual({ key: "17|avenue|rd|sampleton", unit: "4" });
  });
  it("is no site at all without one", () => {
    expect(siteOf("4/17 avenue Rd sampleton")).toBeNull();
  });
});

describe("units", () => {
  it("reads the shapes they come in", () => {
    expect(siteOf("u18/196-202 Fabulum Street, Exampleria NSW")).toEqual({ key: "196-202|fabulum|st|exampleria", unit: "18" });
    expect(siteOf("1a/63 Exampleton Ave\nExampleton NSW 2061")?.unit).toBe("1a");
    expect(siteOf("b308/87 Dummy St\nMockglen NSW 2037")).toEqual({ key: "87|dummy|st|mockglen", unit: "b308" });
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
  expect(siteSearch("106|exampleton|ave|exampleton")).toEqual({ number: "106", word: "exampleton" });
  expect(siteSearch("196-202|fabulum|st|exampleria")).toEqual({ number: "196", word: "fabulum" });
});
