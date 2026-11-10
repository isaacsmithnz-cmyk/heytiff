import { sameStreet, streetOf, streetSearch } from "../street";

describe("streetOf", () => {
  it("reads the unit, number, name and type, the type short", () => {
    expect(streetOf("6/40 Raglan Street, Mosman NSW 2088")).toEqual({ unit: "6", number: "40", name: "raglan", type: "st" });
    expect(streetOf("6/40 Raglan St\nMosman NSW 2088")).toEqual({ unit: "6", number: "40", name: "raglan", type: "st" });
  });

  it("reads a unit written before the number", () => {
    for (const a of ["Unit 6, 40 Raglan St", "Unit 6/40 Raglan St", "U6 40 Raglan St", "Apt 6, 40 Raglan Street", "6 / 40 Raglan St."]) {
      expect(streetOf(a)).toMatchObject({ unit: "6", number: "40", name: "raglan" });
    }
  });

  it("leaves a level out of the place", () => {
    expect(streetOf("Suite 2, Level 4, 40 Miller St, North Sydney")).toEqual({ unit: "2", number: "40", name: "miller", type: "st" });
  });

  it("keeps a number's letter and a range", () => {
    expect(streetOf("60A Raglan St\nMosman NSW 2088")).toMatchObject({ unit: "", number: "60a" });
    expect(streetOf("12 - 14 Pittwater Road, Manly")).toMatchObject({ number: "12-14", name: "pittwater", type: "rd" });
  });

  it("knows Saint from Street", () => {
    expect(streetOf("1 St Johns Rd, Glebe")).toEqual({ unit: "", number: "1", name: "st johns", type: "rd" });
    expect(streetOf("1 The Esplanade, Balmoral")).toEqual({ unit: "", number: "1", name: "the", type: "esp" });
  });

  it("stops at the suburb's state or postcode when there's no type", () => {
    expect(streetOf("40 Raglan, NSW 2088")).toEqual({ unit: "", number: "40", name: "raglan", type: "" });
  });

  it("gives nothing without a number and a street name", () => {
    expect(streetOf("Mosman NSW 2088")).toBeNull();
    expect(streetOf("Lot 12 Smith Rd")).toBeNull();
    expect(streetOf("40 St")).toBeNull();
    expect(streetOf("")).toBeNull();
    expect(streetOf(null)).toBeNull();
  });
});

describe("sameStreet", () => {
  const raglan = streetOf("6/40 Raglan Street, Mosman NSW 2088");

  it("is one place however the street is spelled", () => {
    expect(sameStreet(raglan, streetOf("6/40 Raglan St\nMosman NSW 2088"))).toBe(true);
    expect(sameStreet(raglan, streetOf("Unit 6, 40 Raglan St, Mosman"))).toBe(true);
    expect(sameStreet(streetOf("12 Smith Rd"), streetOf("12 Smith Road, Glebe"))).toBe(true);
    expect(sameStreet(streetOf("40 Raglan, NSW 2088"), streetOf("40 Raglan St"))).toBe(true);
  });

  it("never makes another unit, number or street the same place", () => {
    expect(sameStreet(raglan, streetOf("3/40 Raglan Street\nMosman NSW 2088"))).toBe(false);
    expect(sameStreet(raglan, streetOf("40 Raglan St\nMosman NSW 2088"))).toBe(false);
    expect(sameStreet(raglan, streetOf("60A Raglan St\nMosman NSW 2088"))).toBe(false);
    expect(sameStreet(raglan, streetOf("6/40 Raglan Lane, Mosman"))).toBe(false);
    expect(sameStreet(raglan, streetOf("6/40 Ragland St, Mosman"))).toBe(false);
    expect(sameStreet(raglan, null)).toBe(false);
  });
});

describe("streetSearch", () => {
  it("looks for the number's digits and the name's longest word", () => {
    expect(streetSearch(streetOf("6/40 Raglan Street")!)).toEqual({ number: "40", word: "raglan" });
    expect(streetSearch(streetOf("60A Raglan St")!)).toEqual({ number: "60", word: "raglan" });
    expect(streetSearch(streetOf("1 St Johns Rd")!)).toEqual({ number: "1", word: "johns" });
  });
});
