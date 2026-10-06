/* The printed plan's frame and its type scale — what the sheet draws, and how
   big its derived labels are against the drawing. Pure, so it can be tested
   without rendering a figure. A note's words are NOT sized here: each note
   carries the size it was written at, in world units (notes.ts). */

import type { DesignDocument, Floor } from "./document";
import { isNote, noteBounds, type NoteObject } from "./notes";
import { calloutBounds, calloutContent, calloutLayout, calloutOf } from "./callouts";

export const REF_W = 900; // reference width: text sized as if on a 900px-wide sheet

/* a unit callout's type at reference width: the area line's size, the one
   the rest of the derived text on a plan uses */
export const CALLOUT_FONT_REF = 11;

/** same formula as the canvas: the arrow holds the size it was placed at */
export const northRadius = (floor: Floor): number => {
  const grid = floor.scaleMmPerUnit
    ? 1000 / floor.scaleMmPerUnit
    : floor.plans.length > 0
      ? 100
      : 50;
  return grid * 0.7;
};

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The DRAWING's extent: sheets, rooms, runs, units, the north arrow. Not the
    markup — a note's cloud and words, a callout's leader and bubble — because
    the markup is sized off this, and a size that moved whenever a note did
    would be no lock at all. */
function drawingExtent(doc: DesignDocument, floor: Floor): Extent | null {
  const e: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const eat = (x: number, y: number) => {
    if (x < e.minX) e.minX = x;
    if (y < e.minY) e.minY = y;
    if (x > e.maxX) e.maxX = x;
    if (y > e.maxY) e.maxY = y;
  };

  for (const s of floor.plans) {
    if (!s.width || !s.height) continue; // legacy sheet without stored dims
    if (s.crop) {
      eat(s.x + s.crop.x, s.y + s.crop.y);
      eat(s.x + s.crop.x + s.crop.w, s.y + s.crop.y + s.crop.h);
    } else {
      eat(s.x, s.y);
      eat(s.x + s.width, s.y + s.height);
    }
  }
  const scale = floor.scaleMmPerUnit;
  for (const o of doc.objects) {
    if (o.floorId !== floor.id || isNote(o)) continue;
    if (o.geometry.kind === "polygon" || o.geometry.kind === "polyline")
      for (const p of o.geometry.points) eat(p.x, p.y);
    if (o.geometry.kind === "point") {
      const at = o.geometry.at;
      const w = scale ? Number(o.props.widthMm ?? 800) / scale : 40;
      const h = scale ? Number(o.props.depthMm ?? 300) / scale : 20;
      eat(at.x - w, at.y - h);
      eat(at.x + w, at.y + h);
    }
  }
  if (floor.northPos) {
    const r = northRadius(floor) * 1.8;
    eat(floor.northPos.x - r, floor.northPos.y - r);
    eat(floor.northPos.x + r, floor.northPos.y + r);
  }
  return Number.isFinite(e.minX) ? e : null;
}

/** every cloud on the floor — the stand-in for a drawing that has none */
function cloudExtent(doc: DesignDocument, floor: Floor): Extent | null {
  const e: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const o of doc.objects) {
    if (o.floorId !== floor.id || !isNote(o)) continue;
    for (const p of o.geometry.points) {
      e.minX = Math.min(e.minX, p.x);
      e.minY = Math.min(e.minY, p.y);
      e.maxX = Math.max(e.maxX, p.x);
      e.maxY = Math.max(e.maxY, p.y);
    }
  }
  return Number.isFinite(e.minX) ? e : null;
}

/** the 5% the figure is padded by, on the extent it is padding */
const padOf = (w: number, h: number) => Math.max(w, h) * 0.05;

/** an extent's padded width, over the reference width */
const unitOf = (e: Extent): number => {
  const w = Math.max(e.maxX - e.minX, 1);
  const h = Math.max(e.maxY - e.minY, 1);
  return (w + padOf(w, h) * 2) / REF_W;
};

/** One "screen pixel" of the sheet, in world units: the drawing's padded
    width over the reference width. Every word on paper is a multiple of it.

    Taken from the DRAWING, never from the finished figure: markup in the
    margin widens the figure, and labels sized off it would shrink on the
    page whenever a note was pulled further out.

    A floor that is nothing but markup has no drawing to size against; its
    clouds stand in on paper, so the sheet still has a scale. */
export function sheetUnitOf(doc: DesignDocument, floor: Floor): number | null {
  const e = drawingExtent(doc, floor) ?? cloudExtent(doc, floor);
  return e ? unitOf(e) : null;
}

export function planFigureBounds(
  doc: DesignDocument,
  floor: Floor
): { x: number; y: number; w: number; h: number } | null {
  const e = drawingExtent(doc, floor) ?? cloudExtent(doc, floor);
  const u = sheetUnitOf(doc, floor);
  if (!e || u == null) return null;
  const eat = (x: number, y: number) => {
    if (x < e.minX) e.minX = x;
    if (y < e.minY) e.minY = y;
    if (x > e.maxX) e.maxX = x;
    if (y > e.maxY) e.maxY = y;
  };

  /* The markup goes in once the drawing's extent exists. A note's bounds are
     its cloud, its leader and its words, at the world size it carries. */
  const notes = doc.objects.filter(
    (o): o is NoteObject => o.floorId === floor.id && isNote(o)
  );
  for (const n of notes) {
    const b = noteBounds(n);
    eat(b.x, b.y);
    eat(b.x + b.w, b.y + b.h);
  }
  /* A callout likewise — placed clear of the plan on purpose, exactly like a
     note's margin text, and a figure that framed only the plan would crop the
     label somebody moved somewhere it could be read. Its leader end and its
     bubble, whose type is a multiple of the same unit. */
  const scale = floor.scaleMmPerUnit;
  for (const o of doc.objects) {
    if (o.floorId !== floor.id || o.type !== "unit" || o.geometry.kind !== "point") continue;
    const off = calloutOf(o);
    if (!off) continue;
    const at = o.geometry.at;
    eat(at.x + off.x, at.y + off.y);
    const fp = scale
      ? { w: Number(o.props.widthMm ?? 800) / scale, h: Number(o.props.depthMm ?? 300) / scale }
      : { w: 40, h: 20 };
    const b = calloutBounds(
      calloutLayout({
        at,
        footprint: fp,
        offset: off,
        content: calloutContent(o, null),
        fontSize: CALLOUT_FONT_REF * u,
      })
    );
    eat(b.x, b.y);
    eat(b.x + b.w, b.y + b.h);
  }

  const w = Math.max(e.maxX - e.minX, 1);
  const h = Math.max(e.maxY - e.minY, 1);
  const pad = padOf(w, h);
  return { x: e.minX - pad, y: e.minY - pad, w: w + pad * 2, h: h + pad * 2 };
}
