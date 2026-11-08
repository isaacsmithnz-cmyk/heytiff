/* THE SUN BY TIME OF DAY (Isaac, 8 November 2026: "Build all, 1-10"):
   where the sun stands over the house at an hour of the longest or shortest
   day, so the 3D shows which rooms get the afternoon sun. North comes off
   the plan's own north arrow; the latitude off the time zone the browser is
   in, since a design doesn't hold its site's. Pure. */

const RAD = Math.PI / 180;

/** Latitude, degrees (south negative), from a time zone; Sydney's when it isn't known. */
export function latitudeOf(timeZone: string | undefined): number {
  const z = timeZone ?? "";
  const known: [RegExp, number][] = [
    [/Melbourne|Victoria/, -37.8],
    [/Brisbane|Queensland|Lindeman/, -27.5],
    [/Adelaide|South/, -34.9],
    [/Perth|West/, -31.9],
    [/Hobart|Tasmania|Currie/, -42.9],
    [/Darwin|North/, -12.5],
    [/Auckland|Wellington|Chatham/, -38.5],
    [/Sydney|Canberra|ACT|NSW|Lord_Howe|Broken_Hill/, -33.9],
  ];
  for (const [re, lat] of known) if (re.test(z)) return lat;
  return -33.9;
}

/** The sun at an hour (solar time, 12 = noon) on the longest day, or the shortest: how high, and its bearing from true north, degrees. */
export function sunAt(lat: number, hour: number, winter: boolean): { alt: number; bearing: number } {
  /* the shortest day is 21 June south of the equator, 21 December north of it */
  const day = winter === lat < 0 ? 172 : 355;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365) * RAD;
  const h = (hour - 12) * 15 * RAD;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h));
  /* from south, westward positive; then from north, clockwise */
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const bearing = (((fromSouth / RAD + 180) % 360) + 360) % 360;
  return { alt: alt / RAD, bearing };
}

/** Towards the sun, in the 3D's own axes (x across the plan, z down it, y up), for a plan whose north is `north` degrees clockwise from its up. */
export function towardsSun(alt: number, bearing: number, north: number): [number, number, number] {
  const n = north * RAD;
  const b = bearing * RAD;
  const up: [number, number] = [Math.sin(n), -Math.cos(n)];
  const east: [number, number] = [Math.cos(n), Math.sin(n)];
  const c = Math.cos(alt * RAD);
  return [c * (Math.sin(b) * east[0] + Math.cos(b) * up[0]), Math.sin(alt * RAD), c * (Math.sin(b) * east[1] + Math.cos(b) * up[1])];
}
