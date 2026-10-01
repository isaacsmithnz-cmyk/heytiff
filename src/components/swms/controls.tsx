"use client";

import { useRef, useState } from "react";
import { SIGNATURE_VIEWBOX } from "@/lib/swms/input";

/* THE SWMS'S CONTROLS, shared: the segmented choice, the option row and the
   signature pad. They lived inside the SWMS wizard and the sign-on; the
   certificate wizard and the staff card's signature use the same ones, so a
   choice and a signature look and behave the same wherever they're asked
   for. Styled by swms.css. */

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

export function Choice({
  name,
  checked,
  onChange,
  title,
  sub,
  kind = "radio",
  id,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  sub?: string | null;
  kind?: "radio" | "checkbox";
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`sw-opt${checked ? " on" : ""}${disabled ? " off" : ""}`}>
      <input id={id} type={kind} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{title}</b>
        {sub && <em>{sub}</em>}
      </span>
    </label>
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
      <button
        type="button"
        className="pbtn ghost sm sws-clear"
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
      </button>
    </div>
  );
}
