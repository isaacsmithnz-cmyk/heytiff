import { latitudeOf, sunAt, towardsSun } from "../sun";

describe("the sun over Sydney", () => {
  const lat = latitudeOf("Australia/Sydney");

  it("stands due north at noon, low in winter and high in summer", () => {
    const w = sunAt(lat, 12, true);
    const s = sunAt(lat, 12, false);
    expect(w.alt).toBeCloseTo(90 - 33.9 - 23.44, 0);
    expect(s.alt).toBeCloseTo(90 - 33.9 + 23.44, 0);
    expect(Math.min(w.bearing, 360 - w.bearing)).toBeLessThan(1);
  });

  it("is in the east in the morning and the west in the afternoon", () => {
    expect(sunAt(lat, 9, false).bearing).toBeGreaterThan(45);
    expect(sunAt(lat, 9, false).bearing).toBeLessThan(135);
    expect(sunAt(lat, 16, false).bearing).toBeGreaterThan(225);
    expect(sunAt(lat, 16, false).bearing).toBeLessThan(315);
  });

  it("is down before a winter's dawn", () => {
    expect(sunAt(lat, 6, true).alt).toBeLessThan(0);
  });
});

it("points north up the plan when north is up, and turns with the arrow", () => {
  const [x, , z] = towardsSun(0, 0, 0);
  expect(x).toBeCloseTo(0);
  expect(z).toBeCloseTo(-1);
  const [x2, , z2] = towardsSun(0, 0, 90);
  expect(x2).toBeCloseTo(1);
  expect(z2).toBeCloseTo(0);
});

it("knows a few cities by their time zone, and falls back to Sydney", () => {
  expect(latitudeOf("Australia/Melbourne")).toBe(-37.8);
  expect(latitudeOf("Australia/Perth")).toBe(-31.9);
  expect(latitudeOf(undefined)).toBe(-33.9);
});
