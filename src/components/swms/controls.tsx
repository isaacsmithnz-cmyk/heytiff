"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { SIGNATURE_VIEWBOX } from "@/lib/swms/input";

/* THE SWMS'S CONTROLS, shared: the segmented choice (the letterhead's) and
   the signature pad (the sign-on, the certificate wizard and the staff
   card's signature), so a signature looks and behaves the same wherever it
   is asked for. The wizards' own choices are v2's parts (./wizard). Styled
   by swms.css. */

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  id?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text], i) => (
        <button
          key={v}
          id={i === 0 ? id : undefined}
          type="button"
          className={value === v ? "on" : undefined}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* The drawn path as SVG path data in the stored viewBox — moves and lines,
   rounded, with points closer than a pixel of paper dropped so a slow hand
   doesn't write a megabyte. */
export function SignaturePad({ onChange, label }: { onChange: (path: string) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<string[]>([]);
  const last = useRef<[number, number] | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(r.width, 1)) * SIGNATURE_VIEWBOX.width;
    const y = ((e.clientY - r.top) / Math.max(r.height, 1)) * SIGNATURE_VIEWBOX.height;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };
  const pen = () => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !canvas.current) return null;
    ctx.strokeStyle = getComputedStyle(canvas.current).color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  };

  return (
    <div className="sws-pad">
      <canvas
        ref={canvas}
        width={SIGNATURE_VIEWBOX.width}
        height={SIGNATURE_VIEWBOX.height}
        aria-label={label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drawing.current = true;
          const [x, y] = at(e);
          parts.current.push(`M${x} ${y}`);
          last.current = [x, y];
          const ctx = pen();
          ctx?.beginPath();
          ctx?.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const [x, y] = at(e);
          if (Math.hypot(x - last.current[0], y - last.current[1]) < 1.5) return;
          parts.current.push(`L${x} ${y}`);
          const ctx = pen();
          ctx?.beginPath();
          ctx?.moveTo(last.current[0], last.current[1]);
          ctx?.lineTo(x, y);
          ctx?.stroke();
          last.current = [x, y];
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(parts.current.join(" "));
        }}
        onPointerCancel={() => {
          drawing.current = false;
          onChange(parts.current.join(" "));
        }}
      />
      {empty && <span>Sign here</span>}
      <Button
        kind="quiet"
        size={32}
        className="sws-clear"
        onClick={() => {
          parts.current = [];
          last.current = null;
          const c = canvas.current;
          c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange("");
        }}
      >
        Clear
      </Button>
    </div>
  );
}
