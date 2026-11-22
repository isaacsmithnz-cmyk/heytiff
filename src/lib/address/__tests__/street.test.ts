import { sameStreet, streetOf, streetSearch } from "../street";

describe("streetOf", () => {
  it("reads the unit, number, name and type, the type short", () => {
    expect(streetOf("6/40 Lorem Street, Sampleton NSW 2088")).toEqual({ unit: "6", number: "40", name: "lorem", type: "st" });
    expect(streetOf("6/40 Lorem St\nSampleton NSW 2088")).toEqual({ unit: "6", number: "40", name: "lorem", type: "st" });
  });

  it("reads a unit written before the number", () => {
    for (const a of ["Unit 6, 40 Lorem St", "Unit 6/40 Lorem St", "U6 40 Lorem St", "Apt 6, 40 Lorem Street", "6 / 40 Lorem St."]) {
      expect(streetOf(a)).toMatchObject({ unit: "6", number: "40", name: "lorem" });
    }
  });

  it("leaves a level out of the place", () => {
    expect(streetOf("Suite 2, Level 4, 40 Miller St, North Fakeville")).toEqual({ unit: "2", number: "40", name: "miller", type: "st" });
  });

  it("keeps a number's letter and a range", () => {
    expect(streetOf("60A Lorem St\nSampleton NSW 2088")).toMatchObject({ unit: "", number: "60a" });
    expect(streetOf("12 - 14 Pittwater Road, Manly")).toMatchObject({ number: "12-14", name: "pittwater", type: "rd" });
  });

  it("knows Saint from Street", () => {
    expect(streetOf("1 St Johns Rd, Mockglen")).toEqual({ unit: "", number: "1", name: "st johns", type: "rd" });
    expect(streetOf("1 The Esplanade, Balmoral")).toEqual({ unit: "", number: "1", name: "the", type: "esp" });
  });

  it("stops at the suburb's state or postcode when there's no type", () => {
    expect(streetOf("40 Lorem, NSW 2088")).toEqual({ unit: "", number: "40", name: "lorem", type: "" });
  });

  it("gives nothing without a number and a street name", () => {
    expect(streetOf("Sampleton NSW 2088")).toBeNull();
    expect(streetOf("Lot 12 Smith Rd")).toBeNull();
    expect(streetOf("40 St")).toBeNull();
    expect(streetOf("")).toBeNull();
    expect(streetOf(null)).toBeNull();
  });
});

describe("sameStreet", () => {
  const lorem = streetOf("6/40 Lorem Street, Sampleton NSW 2088");

  it("is one place however the street is spelled", () => {
    expect(sameStreet(lorem, streetOf("6/40 Lorem St\nSampleton NSW 2088"))).toBe(true);
    expect(sameStreet(lorem, streetOf("Unit 6, 40 Lorem St, Sampleton"))).toBe(true);
    expect(sameStreet(streetOf("12 Smith Rd"), streetOf("12 Smith Road, Mockglen"))).toBe(true);
    expect(sameStreet(streetOf("40 Lorem, NSW 2088"), streetOf("40 Lorem St"))).toBe(true);
  });

  it("never makes another unit, number or street the same place", () => {
    expect(sameStreet(lorem, streetOf("3/40 Lorem Street\nSampleton NSW 2088"))).toBe(false);
    expect(sameStreet(lorem, streetOf("40 Lorem St\nSampleton NSW 2088"))).toBe(false);
    expect(sameStreet(lorem, streetOf("60A Lorem St\nSampleton NSW 2088"))).toBe(false);
    expect(sameStreet(lorem, streetOf("6/40 Lorem Lane, Sampleton"))).toBe(false);
    expect(sameStreet(lorem, streetOf("6/40 Loremd St, Sampleton"))).toBe(false);
    expect(sameStreet(lorem, null)).toBe(false);
  });
});

describe("streetSearch", () => {
  it("looks for the number's digits and the name's longest word", () => {
    expect(streetSearch(streetOf("6/40 Lorem Street")!)).toEqual({ number: "40", word: "lorem" });
    expect(streetSearch(streetOf("60A Lorem St")!)).toEqual({ number: "60", word: "lorem" });
    expect(streetSearch(streetOf("1 St Johns Rd")!)).toEqual({ number: "1", word: "johns" });
  });
});
