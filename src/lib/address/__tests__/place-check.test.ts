import { placeFits, placeLine } from "../place-check";
import { suburbOf } from "../street";

/* What Google's autocomplete gave on 26 November 2026, with the streets
   made up: a unit's place came second behind its number the other way
   round, and a street said in one suburb came first from another state. */

describe("the suburb a line gives", () => {
  it("after the street, with a comma or without", () => {
    expect(suburbOf("Unit 2, 26 Lorem Street, Sampleton")).toBe("sampleton");
    expect(suburbOf("2/26 Lorem St, Sampleton NSW, Australia")).toBe("sampleton");
    expect(suburbOf("2/26 Lorem St\nSampleton NSW 2088")).toBe("sampleton");
    expect(suburbOf("26 Lorem Street Sampleton")).toBe("sampleton");
    expect(suburbOf("26 Lorem Street")).toBe("");
  });
});

describe("the place the map found is the place said", () => {
  it("in a suburb a letter out, as the transcriber hears one", () => {
    expect(placeFits("Unit 2, 26 Lorem Street, Samppleton", "2/26 Lorem St, Sampleton NSW, Australia")).toBe(true);
  });
  it("never the unit and number the other way round", () => {
    expect(placeFits("2/28 Lorem St Sampleton", "28/2 Lorem St, Sampleton NSW, Australia")).toBe(false);
    expect(placeFits("2/28 Lorem St, Sampleton", "2/28 Lorem St, Sampleton NSW, Australia")).toBe(true);
  });
  it("never the same number on another street, or in another suburb", () => {
    expect(placeFits("26 Hill Street, Sampleton", "26 Hill Terrace, Sampleton Park WA, Australia")).toBe(false);
    expect(placeFits("26 Hill Street, Sampleton", "26 Hill Street, Crafton West SA, Australia")).toBe(false);
  });
  it("nothing, when no suburb was said: every state has its Hill St", () => {
    expect(placeFits("26 Hill Street", "26 Hill Street, Sampleton NSW, Australia")).toBe(false);
  });
  it("is said without the country", () => {
    expect(placeLine("2/26 Lorem St, Sampleton NSW 2088, Australia")).toBe("2/26 Lorem St, Sampleton NSW 2088");
    expect(placeLine("unit 2/26 Lorem St, Sampleton NSW 2088, Australia")).toBe("2/26 Lorem St, Sampleton NSW 2088");
  });
});
