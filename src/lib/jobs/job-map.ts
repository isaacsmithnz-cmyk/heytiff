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

/* THE HEAD'S MAP (Isaac, 16 November 2026: "the map can probably become like
   a hero", then "zoomed out a bit more so you can see surrounding areas"):
   the right of the job's head, 640 by 112, one step further out than the
   card's was, so the streets round the site show and the pin keeps its size. */
export const HEAD_MAP_SIZE = { width: 640, height: 112 } as const;
export type MapShape = "card" | "head";
/* the head's in colour (Isaac, 16 November 2026: "the map should be in color.
   It looks like it's black and white"); the card's stays grey */
const SHAPES: Record<MapShape, { width: number; height: number; zoom: number; grey: boolean }> = {
  card: { ...MAP_SIZE, zoom: 16, grey: true },
  head: { ...HEAD_MAP_SIZE, zoom: 15, grey: false },
};
export const mapShape = (raw: string | null | undefined): MapShape => (raw === "head" ? "head" : "card");

/* THE HEAD'S MAP DRAWN TO ITS CARD (bug 52, Isaac, 20 November 2026: "map
   misaligned"): the map stands in the head's right column, as wide as the
   Scope tab's column under it and as tall as the words' card beside it
   (rule 31: "the same height and corners"), so the picture is asked for at
   the card's own size to the pixel, so nothing of Google's mark is cut,
   never past Google's 640. Its width is set by the page and its height moves
   only a line of words at a time, so few sizes are ever asked for. A size
   that isn't a number is the wide picture's. */
const HEAD_W = { min: 160, max: 640 };
const HEAD_H = { min: 96, max: 400 };
const snapTo = (raw: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(raw)));
/** The size the head's picture is drawn at: its card's, whole pixels, kept in Google's bounds. */
export function headMapSize(w: unknown, h: unknown): { width: number; height: number } {
  const wn = Number(w);
  const hn = Number(h);
  if (!Number.isFinite(wn) || !Number.isFinite(hn) || wn <= 0 || hn <= 0) return { ...HEAD_MAP_SIZE };
  return { width: snapTo(wn, HEAD_W), height: snapTo(hn, HEAD_H) };
}

const HUES = new Set<string>(Object.keys(PIN));
export const pinHue = (raw: string | null | undefined): Hue => (raw && HUES.has(raw) ? (raw as Hue) : "grey");

/** The address as one line for Google: what ServiceM8 holds, its lines joined. */
export function mapAddress(job: { address?: string | null; geoLine?: string | null }): string | null {
  const written = (job.address ?? "").split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean).join(", ");
  const said = written || (job.geoLine ?? "").trim();
  return said ? said.slice(0, 300) : null;
}

/** Static Maps' address for one job's picture. The key stays on the server. */
export function staticMapUrl(address: string, hue: Hue, key: string, shape: MapShape = "card", size?: { width: number; height: number }): string {
  const { zoom, grey } = SHAPES[shape];
  const { width, height } = shape === "head" && size ? size : SHAPES[shape];
  const p = new URLSearchParams();
  p.set("size", `${width}x${height}`);
  p.set("scale", "2");
  p.set("zoom", String(zoom));
  p.set("maptype", "roadmap");
  if (grey) p.append("style", "saturation:-100");
  p.append("style", "feature:poi|visibility:off");
  p.append("style", "feature:transit|visibility:off");
  p.set("markers", `color:${PIN[hue]}|${address}`);
  p.set("key", key);
  return `https://maps.googleapis.com/maps/api/staticmap?${p.toString()}`;
}

/** Home's map (app/api/home/day-map): one view of the day, a centre and a
    zoom, w × h at twice the pixels, with no marker, since the page draws its
    own pins over it. Points of interest and transit are left off, as on a
    job's map, and so are the roads' little icons. */
export function dayMapUrl(view: { lat: number; lng: number; zoom: number }, w: number, h: number, key: string): string {
  const p = new URLSearchParams();
  p.set("center", `${view.lat},${view.lng}`);
  p.set("zoom", String(view.zoom));
  p.set("size", `${w}x${h}`);
  p.set("scale", "2");
  p.set("maptype", "roadmap");
  p.append("style", "feature:poi|visibility:off");
  p.append("style", "feature:transit|visibility:off");
  p.append("style", "feature:road|element:labels.icon|visibility:off");
  p.set("key", key);
  return `https://maps.googleapis.com/maps/api/staticmap?${p.toString()}`;
}
