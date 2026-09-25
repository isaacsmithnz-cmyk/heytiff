"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { CaptureSheet } from "./note-token";
import { MARK_MASK, TiffMark } from "./tiff-mark";
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

   TAPPING IT ASKS: TALK OR TYPE. The road here is four shapes long and each
   one was tried in production. It began by always starting the mic ("no mode
   to choose first"), which made typing second-class: you arrived recording
   and had to stop a recording you never asked for. So it stopped presuming
   and opened with the caret in the box, Talk beside it (2026-08-08) — and
   talking IS the common case, so pressing Talk every time became a tax. Then
   it opened the way you left it, remembered behind a DEFAULT switch.

   What that cost is why it now asks (Isaac, 2026-08-18): pressing the button
   was a recording before you had decided anything, so a mis-tap was a live
   microphone — and the control that could change it was a PREFERENCE sitting
   in the middle of a capture, governing the next one. Two buttons, asked
   every time, nothing stored. The mic stays an enhancement — no
   ELEVENLABS_API_KEY and the box is simply the only door.

   ── TWO PLACES, AND THE GROUND DECIDES THE SKIN ──

   `topbar`  beside the bell, on the app's black frame. It floated
             bottom-right first and covered the page it sat on; a control
             that is always present has to live somewhere that is always
             empty. The mark is bare on the frame: no disc, no halo. Its
             two gimbal rings are its edge and the light on them is the
             separation (the halo went with the gimbal redesign, 2026-09-25:
             "aura looks too generic ai").

   `sheet`   in a sheet's own header. A sheet is a white surface with a
             scrim under it, and nothing outside that scrim can be clicked —
             which is why the topbar button is unreachable the moment a job
             opens, and why the tag could never do the one job it exists for.
             Isaac's fix, and it is the right one: put a button ON the sheet.
             Here the ground is white, so the skin inverts: the face takes
             the brand gradient and the rings go a step deeper (see
             ./tiff-mark).

   Everything inside is sized OFF THE BUTTON, in the stylesheet: the mark is
   56% of it, the rings 86% and 72%. The button is 36px on the frame, as
   Isaac's prototype drew it, and 30px in a sheet, beside the 30px close ×.
   It carries no sparkle (law 5).

   ── TWO THINGS IT CAN OPEN, AND THE SWITCH DECIDES ──

   Where HOME_DESK gives this viewer the new Home (the owner first, then
   everyone at the flip), the button opens THE TIFF MODAL — one light
   conversation, app-wide, and opening means listening (Isaac, 2026-09-25:
   "opening means listening, from every Tiff button", which reverses the
   18 August door above for the people the switch lets in). Everyone else
   keeps the capture sheet exactly as it is until the flip. The modal lives
   in the frame's host (components/tiff/modal), so a second button cannot
   start a second conversation over the first. */

type Where = "topbar" | "sheet";


export function TiffButton({ where = "topbar" }: { where?: Where }) {
  const scope = useNoteScope();
  const flow = useNoteFlow();
  const tiff = useTiff();
  /** Which button this is, so only the one that opened the modal reads as
      expanded. */
  const id = useId();

  /* The press, made visible: the mark turns once on its own point and a ring
     leaves the button's edge while the sheet blossoms from the same corner —
     the sheet is not a thing that appears, it is the button, grown.
     State-driven rather than :active because the turn outlives the press (a
     tap is ~100ms; the turn is 800). Cleared on a timer, not animationend:
     with motion reduced the animation never runs and the class would stick. */
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!lit) return;
    const t = setTimeout(() => setLit(false), 850);
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
        aria-expanded={tiff.enabled ? tiff.openedBy === id : flow.open}
        style={{ "--tiffbtn-mask": MARK_MASK } as CSSProperties}
        onClick={(e) => {
          /* The modal measures where it grew from itself, in this click. */
          if (tiff.enabled) {
            /* A click with no pointer behind it (`detail` 0) came from the
               keyboard, and a keyboard press moves nothing (law 8): not the
               modal's blossom, and not this button's own turn. */
            const keyboard = e.detail === 0;
            if (!keyboard) setLit(true);
            tiff.open({ from: e.currentTarget, id, keyboard });
            return;
          }
          setLit(true);
          const r = e.currentTarget.getBoundingClientRect();
          setFrom({
            dx: r.left + r.width / 2 - window.innerWidth / 2,
            dy: r.top + r.height / 2 - window.innerHeight / 2,
          });
          flow.setOpen(true);
          /* IT OPENS ON THE CHOICE, and the press stops here (Isaac,
             2026-08-18). This line used to start the microphone, honouring a
             remembered default — so pressing the button WAS a recording
             before anybody had decided anything, and a mis-tap was a live
             mic. The sheet asks now; see `choice` in ./note-flow, and the
             history of the three shapes this has already been. */
        }}
      >
        <span className="tiffbtn-burst" aria-hidden="true" />
        {/* The frame is ink and a sheet is paper; the mark dresses for it. */}
        <TiffMark ground={where === "topbar" ? "ink" : "paper"} />
      </button>

      {/* The SAME sheet the field postures open. What you get must not depend
          on which control you reached it through — only the ENTRANCE differs:
          from this button the sheet blossoms out of the corner the button is
          in; from a field's nudge it simply rises. */}
      {!tiff.enabled && <CaptureSheet flow={flow} entrance="blossom" from={from} />}
    </>
  );
}
