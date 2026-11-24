/* The nearest emergency department: from the list, in a straight line, nearest first; a hospital somebody named
   found on the list only when it's the same one; and no answer with no pin. */

import LIST from "../emergency-departments.json";
import { edNamed, kmBetween, nearestEmergency, pinOf, type EmergencyDepartment } from "../nearest";

const SOME: EmergencyDepartment[] = [
  { name: "Sampleton Hospital", lat: -33.8, lng: 151.0, state: "NSW" },
  { name: "Farside Hospital", lat: -34.5, lng: 151.0, state: "NSW" },
  { name: "Albury Wodonga Health [Albury Campus]", lat: -36.07, lng: 146.92, state: "NSW" },
  { name: "Albury Wodonga Health [Wodonga Campus]", lat: -36.13, lng: 146.88, state: "Vic" },
];

test("a degree of latitude is about 111 km", () => {
  expect(kmBetween({ lat: -33, lng: 151 }, { lat: -34, lng: 151 })).toBeCloseTo(111.2, 0);
});

test("the nearest come first, each with its distance to a tenth of a km", () => {
  const got = nearestEmergency({ lat: -33.81, lng: 151.0 }, 2, SOME);
  expect(got.map((h) => h.name)).toEqual(["Sampleton Hospital", "Farside Hospital"]);
  expect(got[0].km).toBe(1.1);
});

test("no pin, or ServiceM8's 0,0, is no answer", () => {
  expect(pinOf(0, 0)).toBeNull();
  expect(pinOf(null, 151)).toBeNull();
  expect(pinOf("-33.8", "151")).toEqual({ lat: -33.8, lng: 151 });
  expect(nearestEmergency(null, 3, SOME)).toEqual([]);
});

test("a named hospital is on the list only by its own name, the nearest campus where two share it", () => {
  expect(edNamed("the sampleton hospital", null, SOME)?.km).toBeNull();
  expect(edNamed("Sampleton Private Hospital", null, SOME)).toBeNull();
  expect(edNamed("Albury Wodonga Health", { lat: -36.13, lng: 146.88 }, SOME)?.name).toBe("Albury Wodonga Health [Wodonga Campus]");
  expect(edNamed("Albury Wodonga Health", null, SOME)).toBeNull();
  expect(edNamed("", null, SOME)).toBeNull();
});

test("the list: public emergency departments, placed, with no children's hospital on it", () => {
  const list = LIST as EmergencyDepartment[];
  expect(list.length).toBeGreaterThan(300);
  expect(list.every((h) => h.name && Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.lat < -9 && h.lat > -55 && h.lng > 95 && h.lng < 170)).toBe(true);
  expect(list.some((h) => /children/i.test(h.name))).toBe(false);
  expect(list.some((h) => /private/i.test(h.name))).toBe(false);
  for (const big of ["Westmead Hospital", "Royal North Shore Hospital", "Princess Alexandra Hospital", "Gold Coast University Hospital"]) {
    expect(list.some((h) => h.name === big)).toBe(true);
  }
});
