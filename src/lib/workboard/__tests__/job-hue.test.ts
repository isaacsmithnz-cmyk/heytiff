import { jobHue } from "../job-hue";

/* rule 18: a job's colour is its category's, snapped to the eight by hue */
it("snaps a category's colour to the nearest of the eight by hue", () => {
  expect(jobHue("#2E68FF")).toBe("blue");
  expect(jobHue("#22C55E")).toBe("green");
  expect(jobHue("#F59E0B")).toBe("orange");
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
  expect(jobHue("#EF4444", true)).toBe("red");
});
