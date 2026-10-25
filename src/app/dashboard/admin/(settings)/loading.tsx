import { TiffGlyph } from "@/components/notes/tiff-mark";

/* The hold for a section (rule 41), below the frame's layout, so a click
   between two sections keeps the side list and holds only the right side:
   nothing for half a second, then Tiff's mark in the middle of where the
   section will be. */
export default function Loading() {
  return (
    <div className="pg-hold st2-hold" aria-busy="true" aria-live="polite">
      <TiffGlyph size={72} alive working label="Loading" />
    </div>
  );
}
