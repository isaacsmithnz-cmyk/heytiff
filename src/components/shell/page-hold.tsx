import { TiffGlyph } from "@/components/notes/tiff-mark";

/* THE PAGE'S HOLD (rule 41; Isaac, 20 October 2026: "the skeleton loading
   screens never seem to match what the actual content is… a Tiff logo
   spinning quickly instead"). Every dashboard route falls back to this
   while its server render runs: Tiff's mark, in her colours and turning at
   her working speed, in the middle of where the page will be. It claims no
   shape, so it can never be the wrong one.

   Nothing shows for the first half second (rule 27): a page that lands
   quickly never flashes it. */
export function PageHold() {
  return (
    <div className="page in full pg-hold" aria-busy="true" aria-live="polite">
      <TiffGlyph size={72} alive working label="Loading" />
    </div>
  );
}
