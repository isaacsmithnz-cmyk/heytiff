import { Orb } from "@/components/ui/orb";

/* Tiff's waiting chip: the orb with the name of the wait beside it.

   WHY A SPHERE AND NOT THREE DOTS. Three bouncing dots are a borrowed idiom —
   they mean "someone is typing", and nobody is typing. What is actually
   happening is a search across five shelves, a model reading what came back,
   or a recording being turned into words, and the old indicator had no way to
   say any of it. This one has two moving parts and both carry a fact: the orb
   says work is still in flight, and the word beside it says which kind.

   The sphere itself lives in components/ui/orb.tsx, because dictation's
   microphone meter is the same object driven by a live level. */

export type WorkingProps = {
  /** What the wait is called — a phase from the research machine, or the one
      the composer names while a recording is being read back. Never a
      countdown and never a guess. Rendered verbatim; the ellipsis is the
      stylesheet's, so the label stays a plain string a test can match. */
  note: string;
  /** Extra class on the chip. The composer passes `tvsay` to inherit the
      slot the plain voice line used to occupy under the ask bar. */
  className?: string;
};

/* THE WORD IS THE LABEL, AND THE LABEL IS THE WORD. This used to be an
   `aria-label` on a decorative span — a string that existed only for screen
   readers, saying something no sighted reader could see. Now the same
   sentence is on the page, so `role="status"` announcing it is announcing
   what is actually there, and a phase change is one announcement rather than
   a new element to notice.

   THE SHIMMER RUNS ON THE TEXT, NOT UNDER IT. A sweep clipped to the glyphs
   reads as the word itself being lit; a bar sliding behind it reads as a
   skeleton, which is a different promise — a skeleton says "this box will
   become content", and this box is going to be replaced outright. */
export function TiffWorking({ note, className }: WorkingProps) {
  return (
    <span className={className ? `tk-work ${className}` : "tk-work"} role="status">
      <Orb />
      <b>{note}</b>
    </span>
  );
}
