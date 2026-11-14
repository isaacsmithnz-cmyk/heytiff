/* THE MAP OVER A JOB'S ADDRESS, ON ITS OVERVIEW (Isaac, 14 November 2026:
   "Yes, add the map", after its cost: Google's Static Maps, the first 10,000
   a month free on the billing account, then about US$2 per 1,000). Pure: the
   address it's asked for, and the image Google is asked to draw, so the
   route and the tests read one definition.

   ONE PICTURE, NOT A MAP TO DRAG: 320 by 96 at twice the pixels, grey, the
   pin in the job's colour, Google's own mark on it. Static Maps finds the
   address itself, so no Geocoding is paid for. */

import type { Hue } from "@/components/parts/state";

/** The pin's colour: the job's, as its number box wears it (rules 15, 18, 19). */
const PIN: Record<Hue, string> = {
  red: "0xBE123C",
  orange: "0xEA580C",
  yellow: "0xEAB308",
  green: "0x15803D",
  blue: "0x2563EB",
  purple: "0x7E22CE",
  pink: "0xDB2777",
  grey: "0x5F6A79",
};

export const MAP_SIZE = { width: 320, height: 96 } as const;

const HUES = new Set<string>(Object.keys(PIN));
export const pinHue = (raw: string | null | undefined): Hue => (raw && HUES.has(raw) ? (raw as Hue) : "grey");

/** The address as one line for Google: what ServiceM8 holds, its lines joined. */
export function mapAddress(job: { address?: string | null; geoLine?: string | null }): string | null {
  const written = (job.address ?? "").split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean).join(", ");
  const said = written || (job.geoLine ?? "").trim();
  return said ? said.slice(0, 300) : null;
}

/** Static Maps' address for one job's picture. The key stays on the server. */
export function staticMapUrl(address: string, hue: Hue, key: string): string {
  const p = new URLSearchParams();
  p.set("size", `${MAP_SIZE.width}x${MAP_SIZE.height}`);
  p.set("scale", "2");
  p.set("zoom", "16");
  p.set("maptype", "roadmap");
  p.append("style", "saturation:-100");
  p.append("style", "feature:poi|visibility:off");
  p.append("style", "feature:transit|visibility:off");
  p.set("markers", `color:${PIN[hue]}|${address}`);
  p.set("key", key);
  return `https://maps.googleapis.com/maps/api/staticmap?${p.toString()}`;
}
