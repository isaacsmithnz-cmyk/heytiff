/* ── what a bare scroll does on the canvas: zoom, or pan ──
   A setting, because reading the DEVICE off the wheel event was tried twice
   and wrong twice — a macOS mouse notch is small, and a high-resolution
   wheel's deltas are fractional, so both were mistaken for a trackpad (see
   `readWheel`). The shapes overlap; the user knows which peripheral is under
   their hand and we do not. So they say, once, and the canvas obeys.

   The choice is a DEVICE setting, not a document one — it belongs to this
   machine and whatever is plugged into it — so it lives in localStorage
   beside the cockpit pins rather than in the design.

   PAN IS THE DEFAULT, and the default matters more than it looks: whichever
   way it falls, one device is wrong until someone finds the control. It goes
   to the trackpad because the two costs are not equal. A trackpad has no
   OTHER pan gesture — middle-drag needs a button it hasn't got, and
   hold-Space dies the moment focus enters the calibration field — so
   defaulting to zoom leaves it unable to cross a plan at all, which is
   exactly what shipping the other way did for one day. A mouse set to pan
   still zooms with cmd+wheel and still pans by middle-drag, so nothing is out
   of reach while its owner picks the other option once.

   THE CONTROL USED TO LIVE HERE and it was a pair of 28px icons on the zoom
   strip, whose "scroll zooms" half rendered as a diagonal-arrows EXPAND glyph
   two buttons away from Fit. It was unreadable, and it was reported as such.
   The choice is now a named line in the View menu (`view-menu.tsx`); this
   file is just the store. */

import { useSyncExternalStore } from "react";
import type { WheelMode } from "@/lib/studio/wheel";

const WHEEL_KEY = "ht-wheel";

function readWheelMode(): WheelMode {
  try {
    return localStorage.getItem(WHEEL_KEY) === "zoom" ? "zoom" : "pan";
  } catch {
    return "pan"; // storage unavailable — the trackpad-safe default
  }
}
/* localStorage does not exist on the server, so the markup that hydrates has
   to be the default and only then become the stored choice. That is exactly
   what the server-snapshot argument is for. */
const serverWheelMode = (): WheelMode => "pan";

const listeners = new Set<() => void>();

/** Choose what a bare scroll does. Written by the View menu. */
export function setWheelMode(v: WheelMode) {
  try {
    localStorage.setItem(WHEEL_KEY, v);
  } catch {
    /* private mode — the choice won't survive a reload, but it works now */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** The current setting, live across every canvas and browser tab. */
export function useWheelMode(): WheelMode {
  return useSyncExternalStore(subscribe, readWheelMode, serverWheelMode);
}
