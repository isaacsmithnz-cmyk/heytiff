"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

  /* PORTALLED TO BODY, and it has to be — this is the app's standing modal
     rule (dashboard overlays portal to body) arriving from a new direction.

     Rendered in place inside `.fg` the button is UNREACHABLE the moment any
     sheet opens: `.wb2-scrim` is portalled to body at z-index 100 and swallows
     every click. Raising the z-index does not help, and that is the part worth
     writing down — a probe with the maximum possible z-index (2147483647)
     still loses inside `.fg` and wins from body. `.fg` is `position:fixed`
     with `z-index:auto` and no other inducer, so by the spec its positioned
     descendants should escape into the root stacking context; in practice the
     fixed frame traps them. Whatever the mechanism, no z-index reaches out of
     it, so the element has to leave.

     Found by opening a visit on the real board. jsdom has no hit-testing, so
     the suite could not have caught it — and it broke precisely the case the
     context tag exists for: taking a note while a job is open in front of you.

     `mounted` keeps the server render empty. `document` does not exist during
     SSR, and a button that appears one frame into hydration is invisible next
     to a frame that is already streaming its chrome. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
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
          {/* The glass rim is genuinely translucent and picks up the page
              behind it; this core is what keeps the mark at full contrast on
              top of it. A single flat translucent fill lifts the ground to
              mid-slate over the app's light surfaces and the chevron reads
              faded — that shipped once and was caught by eye. */}
          <span className="tiffbtn-core" aria-hidden="true" />
          <Chevron size={27} gradient className="tiffbtn-mk" />
          <span className="tiffbtn-spark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
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
    </>,
    document.body
  );
}
