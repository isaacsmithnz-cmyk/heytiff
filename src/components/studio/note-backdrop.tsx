/* A NOTE CAN BLUR WHAT IS BEHIND ITS WORDS (Isaac, 2026-11-01): off until it is
   clicked, then a slider, with a soft edge so the plan comes back gradually.
   The canvas and the sheet both draw it through here, so screen and paper can
   never drift. */

import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/parts/tick";
import { NOTE_BLUR_ON, noteBackdrop, type NoteRect } from "@/lib/studio/notes";

/** the work under the notes, drawn again blurred: `under` is that work's group */
export function NoteBackdrop({ id, under, box, fontSize, blur }: { id: string; under: string; box: NoteRect; fontSize: number; blur: number }) {
  const { region, inner, feather, strength } = noteBackdrop(box, fontSize, blur);
  return (
    <>
      <filter
        id={id}
        filterUnits="userSpaceOnUse"
        primitiveUnits="userSpaceOnUse"
        x={region.x}
        y={region.y}
        width={region.w}
        height={region.h}
        colorInterpolationFilters="sRGB"
      >
        {/* on paper, so the sharp drawing under it can't show through a faded plan */}
        <feFlood floodColor="#fff" result="paper" />
        <feGaussianBlur in="SourceGraphic" stdDeviation={strength} result="soft" />
        <feMerge result="blurred">
          <feMergeNode in="paper" />
          <feMergeNode in="soft" />
        </feMerge>
        <feFlood floodColor="#000" x={inner.x} y={inner.y} width={inner.w} height={inner.h} result="block" />
        <feGaussianBlur in="block" stdDeviation={feather} result="edge" />
        <feComposite in="blurred" in2="edge" operator="in" />
      </filter>
      <use href={`#${under}`} filter={`url(#${id})`} pointerEvents="none" />
    </>
  );
}

/* the drag shows live; only letting go is written, so a drag is one undo step */
function BlurSlider({ blur, onLive, onCommit }: { blur: number; onLive: (blur: number) => void; onCommit: (blur: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => {
      setHeld(null);
      commit.current(Number(el.value) / 100);
    };
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, []);
  return (
    <input
      ref={input}
      className="ds-note-blur-slider"
      type="range"
      min={5}
      max={100}
      step={5}
      aria-label="How much blur"
      value={held ?? Math.round(blur * 100)}
      onChange={(e) => {
        setHeld(Number(e.target.value));
        onLive(Number(e.target.value) / 100);
      }}
    />
  );
}

export function NoteBlurControl({ blur, onLive, onCommit }: { blur: number; onLive: (blur: number) => void; onCommit: (blur: number) => void }) {
  const on = blur > 0;
  return (
    <div className="ds-note-blur">
      <Switch checked={on} label="Blur behind" onChange={(next) => onCommit(next ? NOTE_BLUR_ON : 0)} />
      {on && <BlurSlider blur={blur} onLive={onLive} onCommit={onCommit} />}
    </div>
  );
}
