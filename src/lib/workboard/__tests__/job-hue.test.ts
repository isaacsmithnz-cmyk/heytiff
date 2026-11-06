import { jobHue } from "../job-hue";

/* rule 18: a job's colour is its category's, snapped to the eight by hue */
it("snaps a category's colour to the nearest of the eight by hue", () => {
  expect(jobHue("#2E68FF")).toBe("blue");
  expect(jobHue("#22C55E")).toBe("green");
  expect(jobHue("#F59E0B")).toBe("pink");
  expect(jobHue("#FDE047")).toBe("yellow");
  expect(jobHue("#8B5CF6")).toBe("purple");
  expect(jobHue("#EC4899")).toBe("pink");
  expect(jobHue("0ff")).toBe("blue");
});

it("makes a category with no hue grey, and never red from a category", () => {
  expect(jobHue(null)).toBe("grey");
  expect(jobHue("")).toBe("grey");
  expect(jobHue("#9CA3AF")).toBe("grey");
  expect(jobHue("#FFFFFF")).toBe("grey");
  expect(jobHue("not a colour")).toBe("grey");
  expect(jobHue("#EF4444")).not.toBe("red");
  expect(jobHue("#EF4444", "Unsuccessful")).toBe("red");
});

/* Isaac, 6 November 2026: "Quotes should be orange", and "Pink" for the
   categories that were orange, so a booked job is never taken for a quote */
it("makes a quote orange over its category, and no category orange", () => {
  expect(jobHue("#E7B5FF", "Quote")).toBe("orange");
  expect(jobHue(null, " quote ")).toBe("orange");
  expect(jobHue("#FFD098")).toBe("pink");
  expect(jobHue("#FFB5B5", "Work Order")).toBe("pink");
  expect(jobHue("#FFD098", "Unsuccessful")).toBe("red");
});
