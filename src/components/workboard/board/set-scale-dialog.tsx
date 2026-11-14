"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";

/* SET SCALE (Isaac, 14 November 2026, the mock
   https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs: "Like plans uploaded,
   tiff read but scale is incomplete?", "Yep"). A plan Tiff read with no
   scale to be had asks for one: the page, the two ends of a length you know
   pressed on it, and the length typed. It is saved on the job's plan, so
   every design, heat load and quote sizes the rooms by it.

   Check scale is the same dialog on a plan whose scale rests on one printed
   figure: it opens on that figure's line and its length, to be left as it
   is or put right.

   The points are kept in the page's own pixels, so what's saved doesn't
   depend on how large the page is drawn. A press on the page puts down the
   next end (a third starts again); an end can be dragged to where it
   belongs. */

export type ScalePoint = { x: number; y: number };
export type ScalePage = { url: string; width: number; height: number; at: { a: ScalePoint; b: ScalePoint; mm: number } | null };

/** the dot's size on screen, whatever the page's size */
const DOT_PX = 7;
/** how near a press must land to pick an end up, on screen */
const GRAB_PX = 14;

/** The typed length in millimetres, or null: digits, with spaces and commas let through. */
export function lengthOf(typed: string): number | null {
  const s = typed.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const mm = Number(s);
  return mm > 0 ? mm : null;
}

export function SetScaleDialog({
  heading,
  caption,
  load,
  onSave,
  onClose,
}: {
  heading: "Set scale" | "Check scale";
  /** the page's caption, "Ground floor, page 1": the picture's name */
  caption: string;
  load: () => Promise<ScalePage | null>;
  /** null once it's saved, or the reason not */
  onSave: (a: ScalePoint, b: ScalePoint, mm: number) => Promise<string | null>;
  onClose: () => void;
}) {
  const [page, setPage] = useState<ScalePage | null>(null);
  const [a, setA] = useState<ScalePoint | null>(null);
  const [b, setB] = useState<ScalePoint | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** page pixels to one screen pixel, for the dots */
  const [unit, setUnit] = useState(1);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<"a" | "b" | null>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    let live = true;
    loadRef.current()
      .then((p) => {
        if (!live) return;
        if (!p) return setError("The page couldn't be opened. Try again.");
        setPage(p);
        if (p.at) {
          setA(p.at.a);
          setB(p.at.b);
          setTyped(String(Math.round(p.at.mm)));
        }
      })
      .catch(() => live && setError("The page couldn't be opened. Try again."));
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = svg.current;
    if (!el || !page) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setUnit(page.width / w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  /** where a press landed, in the page's pixels */
  const at = (e: ReactPointerEvent): ScalePoint | null => {
    const el = svg.current;
    if (!el || !page) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const x = ((e.clientX - r.left) / r.width) * page.width;
    const y = ((e.clientY - r.top) / r.height) * page.height;
    return { x: Math.min(page.width, Math.max(0, x)), y: Math.min(page.height, Math.max(0, y)) };
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (busy) return;
    const p = at(e);
    if (!p) return;
    setError(null);
    const near = (q: ScalePoint | null) => !!q && Math.hypot(q.x - p.x, q.y - p.y) <= GRAB_PX * unit;
    if (near(b)) dragging.current = "b";
    else if (near(a)) dragging.current = "a";
    else if (!a || (a && b)) {
      /* the first end, or a third press: start again from here */
      setA(p);
      setB(null);
      dragging.current = "a";
    } else {
      setB(p);
      dragging.current = "b";
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const p = at(e);
    if (!p) return;
    if (dragging.current === "a") setA(p);
    else setB(p);
  };
  const up = () => {
    dragging.current = null;
  };

  const mm = lengthOf(typed);
  const ready = !!a && !!b && mm != null && !busy;
  const save = async () => {
    if (!a || !b || mm == null) return;
    setBusy(true);
    setError(null);
    const why = await onSave(a, b, mm).catch(() => "The scale couldn't be saved. Try again.");
    setBusy(false);
    if (why) setError(why);
    else onClose();
  };

  const r = DOT_PX * unit;
  return (
    <Dialog
      heading={heading}
      onClose={onClose}
      width={720}
      dismissable={!busy}
      foot={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="main" disabled={!ready} onClick={() => void save()}>
            Set scale
          </Button>
        </>
      }
    >
      <div className="jpl-scale">
        <div className="jpl-scale-page" style={page ? { aspectRatio: `${page.width} / ${page.height}`, width: `min(100%, calc(56vh * ${page.width / page.height}))` } : undefined}>
          {page ? (
            <svg ref={svg} viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={caption} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <image href={page.url} width={page.width} height={page.height} />
              {a && b && <line className="jpl-scale-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
              {a && <circle className="jpl-scale-dot" cx={a.x} cy={a.y} r={r} />}
              {b && <circle className="jpl-scale-dot" cx={b.x} cy={b.y} r={r} />}
            </svg>
          ) : (
            !error && (
              <span className="jpl-busy" role="status">
                Opening the page
              </span>
            )
          )}
        </div>
        <Field label="Length between the two points">
          <span className="jpl-scale-len">
            <TextInput
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) void save();
              }}
            />
            <span>mm</span>
          </span>
        </Field>
        {error && (
          <p className="ds2-nd-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
