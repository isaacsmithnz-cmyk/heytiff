import { useState } from "react";
import { CaptureSheet } from "../../note-token";
import { useNoteFlow } from "../../note-flow";
import { useNoteScope } from "../../note-context";

/* THE CAPTURE SHEET'S DOOR, for the sheet's own tests.

   The Tiff button opened the capture sheet for everyone the HOME_DESK
   switch left out. The switch went with the old Home (2026-09-26), and the
   button opens the Tiff modal now, so nothing on a screen opens this sheet
   any more. What it is made of (the ribbon, the job line, the body and the
   review) still answers a field's and a strip's "Have a look" until the old
   capture UI goes (the new Home's H25), so the tests that walk it keep a way
   in: this, the button's old press kept to the letter — the same name, the
   same expanded state, and the sheet grown from where it was pressed. It
   lives in `fixtures/` (jest ignores that folder as a suite) and goes with
   the sheet. */

export function CaptureDoor() {
  const flow = useNoteFlow();
  const scope = useNoteScope();
  const [from, setFrom] = useState<{ dx: number; dy: number } | null>(null);
  const label = scope.targetLabel ? `Ask or tell Tiff about ${scope.targetLabel}` : "Ask or tell Tiff";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={flow.open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setFrom({
            dx: r.left + r.width / 2 - window.innerWidth / 2,
            dy: r.top + r.height / 2 - window.innerHeight / 2,
          });
          flow.setOpen(true);
        }}
      />
      <CaptureSheet flow={flow} entrance="blossom" from={from} />
    </>
  );
}
