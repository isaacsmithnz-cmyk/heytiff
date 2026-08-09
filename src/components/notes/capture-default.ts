"use client";

import { useCallback, useSyncExternalStore } from "react";

/* HOW THE SHEET OPENS: talking, or typing.

   The Tiff button has now been all three ways round, and the history is the
   argument for where it landed. It started by always starting the mic ("no
   mode to choose first"), which made typing second-class — you arrived
   recording and had to stop a recording you never asked for. So it stopped
   presuming, and opened with the caret in the box and a Talk button beside
   it. Isaac, using it: talking is what he actually does, and pressing Talk
   every time is a tax on the common case.

   Neither default is right for everyone, so this stops being a decision
   somebody makes on your behalf. IT IS YOUR LAST CHOICE, remembered: press
   Type on the sheet and it opens in the box from then on, press Talk and it
   opens listening. Ships as `talk`, because that is the case being paid for.

   THE CONTROL IS ALWAYS ON THE SHEET, which is the thing that makes storing
   this safe. The lesson of the `?voice=live` sessionStorage bug (see
   ./dictation) is not "never persist" — it is never persist something
   INVISIBLE. A transport nobody could see cost an hour of debugging a
   feature that was not broken. This one is legible every time the sheet
   opens: whichever mode you are in, the other one is a button in front of
   you, so a default you have forgotten setting is one press from obvious.

   PER DEVICE, DELIBERATELY. localStorage rather than a column, because the
   right answer depends on where you are standing — a phone in a plant room
   wants the mic, the same person at a desk with a keyboard may not. */

export type CaptureMode = "talk" | "type";

const KEY = "heytiff.capture.mode";

/** The shipped default, and what every server render and first client
    render uses — see the hydration note below. */
export const DEFAULT_CAPTURE_MODE: CaptureMode = "talk";

/* The last choice made this session. It is the answer when storage is
   unavailable — in private mode the preference should still HOLD, it just
   won't outlive the tab. Reading straight through to localStorage without
   this would mean a locked-down browser silently ignored the button. */
let chosenThisSession: CaptureMode | null = null;

const read = (): CaptureMode => {
  try {
    const stored = localStorage.getItem(KEY);
    /* Where storage WORKS it is the only source of truth. Consulting the
       session value as well would let a choice outlive the storage it was
       cleared from — which is a stale preference in the app, and one test
       deciding the next one's opening mode in jest. */
    return stored === "type" || stored === "talk" ? stored : DEFAULT_CAPTURE_MODE;
  } catch {
    /* Private mode, or storage disabled. A preference is not worth an
       exception — the choice still holds, it just cannot be written down. */
    return chosenThisSession ?? DEFAULT_CAPTURE_MODE;
  }
};

/* localStorage is an external store, so it is read through the hook React
   provides for external stores rather than mirrored into state. Two things
   fall out of that, both of which we want:

   HYDRATION IS HANDLED BY THE HOOK. `getServerSnapshot` is what the server
   and the hydrating client render, so the markup matches; React then reads
   the real value and re-renders if it differs. Mirroring into `useState`
   and filling it from an effect does the same job by hand, and lints as
   what it is — a synchronous setState in an effect, i.e. a cascading
   render. (A lazy `useState` initialiser would be worse still: a
   browser-only value in the FIRST client render is the hydration failure
   this codebase has already paid for once.)

   OTHER TABS STAY IN STEP for free, via the `storage` event — which does
   not fire in the tab that wrote, hence the local listener set too. */
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
};

/** Safe to call every render: it returns a primitive, so React compares it
    by value and there is no snapshot-identity loop to fall into. */
const getSnapshot = (): CaptureMode => read();
const getServerSnapshot = (): CaptureMode => DEFAULT_CAPTURE_MODE;

export function useCaptureMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((next: CaptureMode) => {
    chosenThisSession = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Nothing to tell anyone: the choice holds for this session either
         way, it just will not outlive it. */
    }
    listeners.forEach((l) => l());
  }, []);

  return { mode, choose };
}
