"use client";

import { useEffect, useState } from "react";
import { CaptureSheet } from "./note-token";
import { TiffMark } from "./tiff-mark";
import { useNoteFlow } from "./note-flow";
import { useNoteScope } from "./note-context";

/* THE TIFF BUTTON — one way in, wherever you are.

   The five controls PR #287 collapsed were five ways to say something to the
   app. This is the next step of the same argument: one PLACE to say it. What
   changes between screens is not the control but what it is POINTED AT, which
   arrives through note-context from whatever is underneath.

   IT IS TIFF'S MARK, NOT A MICROPHONE, and that is the decision the rest
   follows from. A mic advertises one thing; this takes a question, a note, a
   task or a debrief and works out which it was. Isaac's rule from #287 —
   "never a bare mic", because a lone microphone hides typing — is not broken
   by a single button here: it opens a sheet with a textarea in it, so typing
   is one tap away and visible the moment you arrive.

   TAPPING IT OPENS THE SHEET READY FOR EITHER — the caret already in the
   box, Talk one tap away. It used to start the mic on its own (there was "no
   mode to choose first"), and that made typing second-class in practice: you
   arrived recording, and reaching the box meant stopping a recording you
   never asked for. Isaac reversed it with the premium sheet (2026-08-08):
   type OR talk is the person's call, made on the sheet, not by the button.
   The mic stays an enhancement — no ELEVENLABS_API_KEY simply means the
   sheet opens without a Talk button.

   ── TWO PLACES, AND THE GROUND DECIDES THE SKIN ──

   `topbar`  beside the bell, on the app's black frame. It floated
             bottom-right first and covered the page it sat on; a control
             that is always present has to live somewhere that is always
             empty. On black a dark button disappears, so the face is glass
             and the ANIMATED GRADIENT HALO does the separating.

   `sheet`   in a sheet's own header. A sheet is a white surface with a
             scrim under it, and nothing outside that scrim can be clicked —
             which is why the topbar button is unreachable the moment a job
             opens, and why the tag could never do the one job it exists for.
             Isaac's fix, and it is the right one: put a button ON the sheet.
             Here the ground is white, so the skin inverts — a dark face with
             the core behind the mark, and no halo, because a coloured glow
             on white is a smudge.

   The marks are sized OFF THE BUTTON in both. They stayed at their 58px
   sizes once when the button shrank to 44 and immediately read as crowded;
   the approved ratios are chevron ~46%, sparkle ~30%. */

type Where = "topbar" | "sheet";


/** 44px on the topbar, 30px in a sheet header beside the close ×. */
const SIZES: Record<Where, { chevron: number; spark: number }> = {
  topbar: { chevron: 20, spark: 13 },
  sheet: { chevron: 14, spark: 9 },
};

export function TiffButton({ where = "topbar" }: { where?: Where }) {
  const scope = useNoteScope();
  const flow = useNoteFlow();
  const size = SIZES[where];

  /* The press, made visible: the halo flares and a wash of it BURSTS out of
     the button while the sheet blossoms from the same corner — the sheet is
     not a thing that appears, it is the button, grown. State-driven rather
     than :active because the flare outlives the press (a tap is ~100ms; the
     burst is 550). Cleared on a timer, not animationend: with motion reduced
     the animation never ends and the class would stick. */
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!lit) return;
    const t = setTimeout(() => setLit(false), 600);
    return () => clearTimeout(t);
  }, [lit]);

  /* WHERE THE SHEET GROWS FROM, measured rather than guessed. The entrance
     used to be a clip circle at a hardcoded corner, which was only ever
     right for one viewport width and one card position — and centring the
     card made it plainly wrong. The button knows where it is, so it says:
     its offset from the viewport centre is exactly the translate that puts
     the (centred) card's middle on top of it. Read in the handler, never
     during render — a layout measurement in a render body is the hydration
     trap this codebase has paid for once already. */
  const [from, setFrom] = useState<{ dx: number; dy: number } | null>(null);

  /* A sheet says what it is about, so its button can say what it will do
     with what you say — the topbar's cannot, because the topbar is nowhere
     in particular. */
  const label = scope.targetLabel
    ? `Ask or tell Tiff about ${scope.targetLabel}`
    : "Ask or tell Tiff";

  return (
    <>
      <button
        type="button"
        className={`tiffbtn tiffbtn-${where}${lit ? " lit" : ""}`}
        aria-label={label}
        title={where === "sheet" ? label : undefined}
        aria-haspopup="dialog"
        aria-expanded={flow.open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFrom({
            dx: r.left + r.width / 2 - window.innerWidth / 2,
            dy: r.top + r.height / 2 - window.innerHeight / 2,
          });
          setLit(true);
          flow.setOpen(true);
        }}
      >
        <span className="tiffbtn-burst" aria-hidden="true" />
        {/* The core holds the mark's contrast on top of a LIGHT ground and is
            wrong on a dark one, where it would only mute the halo. */}
        <TiffMark
          chevron={size.chevron}
          spark={size.spark}
          halo={where === "topbar"}
          core={where === "sheet"}
        />
      </button>

      {/* The SAME sheet the field postures open. What you get must not depend
          on which control you reached it through — only the ENTRANCE differs:
          from this button the sheet blossoms out of the corner the button is
          in; from a field's nudge it simply rises. */}
      <CaptureSheet flow={flow} entrance="blossom" from={from} />
    </>
  );
}
