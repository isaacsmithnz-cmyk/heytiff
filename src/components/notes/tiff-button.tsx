"use client";

import { Chevron } from "@/components/logo";
import { CaptureSheet } from "./note-token";
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

   TAPPING IT STARTS LISTENING. There is no mode to choose first. On a
   deployment with no ELEVENLABS_API_KEY it opens the same sheet with the
   caret in the box instead — the mic is an enhancement, never the only way in.

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

  /* A sheet says what it is about, so its button can say what it will do
     with what you say — the topbar's cannot, because the topbar is nowhere
     in particular. */
  const label = scope.targetLabel
    ? `Ask or tell Tiff about ${scope.targetLabel}`
    : scope.voiceEnabled
      ? "Ask or tell Tiff — starts listening"
      : "Ask or tell Tiff";

  return (
    <>
      <button
        type="button"
        className={`tiffbtn tiffbtn-${where}`}
        aria-label={label}
        title={where === "sheet" ? label : undefined}
        aria-haspopup="dialog"
        aria-expanded={flow.open}
        onClick={() => {
          flow.setOpen(true);
          if (scope.voiceEnabled) flow.dict.start();
        }}
      >
        {where === "topbar" && <span className="tiffbtn-halo" aria-hidden="true" />}
        <span className="tiffbtn-face">
          {/* The core holds the mark's contrast on top of a LIGHT ground and
              is wrong on a dark one, where it would only mute the halo. */}
          {where === "sheet" && <span className="tiffbtn-core" aria-hidden="true" />}
          <Chevron size={size.chevron} gradient className="tiffbtn-mk" />
          <span className="tiffbtn-spark" aria-hidden="true">
            <svg width={size.spark} height={size.spark} viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                {/* A fixed brand gradient, so a constant id is safe: identical
                    defs never collide visually, and unlike a render-time
                    counter it is identical on the server and the client. */}
                <linearGradient id="tiffSpark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#00E5C0" />
                  <stop offset="0.55" stopColor="#2E68FF" />
                  <stop offset="1" stopColor="#8A2BE2" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.8 14 9l6.2 2L14 13l-2 6.2L10 13l-6.2-2L10 9Zm7.2 12.4.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9Z"
                fill="url(#tiffSpark)"
              />
            </svg>
          </span>
        </span>
      </button>

      {/* The SAME sheet the field postures open. What you get must not depend
          on which control you reached it through. */}
      <CaptureSheet flow={flow} />
    </>
  );
}
