"use client";

import { Chevron } from "@/components/logo";
import { CaptureSheet } from "./note-token";
import { useNoteFlow } from "./note-flow";
import { useNoteScope } from "./note-context";

/* THE TIFF BUTTON — one way in, in the same corner of every screen.

   The five controls PR #287 collapsed were five ways to say something to the
   app. This is the next step of the same argument: one PLACE to say it. It
   lives in the frame rather than on a screen, so it is in the same corner of
   the workboard, a job card, the timesheet and your vehicle — and the thing
   that changes between them is not the control but what it is pointed at,
   which arrives through note-context from whatever screen is underneath.

   IT LIVES IN THE TOPBAR, beside the bell. It floated bottom-right first and
   that was wrong for a plain reason Isaac hit immediately: a thing that hovers
   over the page covers the page, and on a long board it sat on top of the
   content you were reading. A control that is always present has to be
   somewhere that is always empty, and the topbar is the only such place.

   The glow is not decoration either — the topbar is transparent over the
   app's black frame, so a dark glass button on it is nearly invisible. The
   animated gradient halo is what separates it from the ground, and it is the
   same breathing gradient the composer's ask bar wears.

   IT IS TIFF'S MARK, NOT A MICROPHONE, and that is the design decision the
   rest follows from. A mic advertises one thing; this takes a question, a
   note, a task or a debrief and works out which it was. Isaac's rule from
   #287 — "never a bare mic", because a lone microphone hides typing — is not
   broken by a single button here: it opens a sheet with a textarea in it, so
   typing is one tap away and visible the moment you arrive.

   TAPPING IT STARTS LISTENING. There is no mode to choose first. On a
   deployment with no ELEVENLABS_API_KEY it opens the same sheet with the
   caret in the box instead, which is the same rule every posture follows —
   the mic is an enhancement and never the only way in. */

export function TiffButton() {
  const scope = useNoteScope();
  const flow = useNoteFlow();

  return (
    <>
      <button
        type="button"
        className="tiffbtn"
        aria-label={scope.voiceEnabled ? "Ask or tell Tiff — starts listening" : "Ask or tell Tiff"}
        aria-haspopup="dialog"
        aria-expanded={flow.open}
        onClick={() => {
          flow.setOpen(true);
          if (scope.voiceEnabled) flow.dict.start();
        }}
      >
        <span className="tiffbtn-halo" aria-hidden="true" />
        <span className="tiffbtn-face">
          {/* NO DARK CORE HERE. The core exists to hold the mark's contrast
              on top of LIGHT page content, which is what the floating version
              sat over. On the black topbar it would be a dark shape on a dark
              ground; the glass matches the bell beside it and the halo does
              the separating. */}
          {/* Sized OFF THE BUTTON, not fixed. Both marks stayed at their
              58px-button sizes when this shrank to 44 for the topbar, which
              put the chevron at 61% of the face and overlapped the sparkle
              into it — the crowding Isaac spotted immediately. The ratios
              below are the approved ones: chevron ~46%, sparkle ~30%. */}
          <Chevron size={20} gradient className="tiffbtn-mk" />
          <span className="tiffbtn-spark" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
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
