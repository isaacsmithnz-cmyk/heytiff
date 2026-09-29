import type { NoteWord } from "@/lib/workboard/sm8-mentions";

/** A ServiceM8 note as it was written, each person it names a pill where
    their @handle stood. One pill everywhere a note is quoted: the job's
    strip and Home's diary. */
export function NoteWords({ words }: { words: readonly NoteWord[] }) {
  return (
    <>
      {words.map((w, i) =>
        "pill" in w ? (
          <span key={i} className="wb2-jcattpill" data-tone={w.tone}>
            {w.pill}
          </span>
        ) : (
          w.text
        ),
      )}
    </>
  );
}
