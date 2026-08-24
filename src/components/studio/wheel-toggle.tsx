"use client";
/* ── what a bare scroll does on the canvas: zoom, or pan ──
   This control exists because reading the DEVICE off the wheel event was wrong
   twice — a macOS mouse notch is small, and a high-resolution wheel's deltas
   are fractional, so both were mistaken for a trackpad (see `readWheel`). The
   shapes overlap; the user knows which peripheral is under their hand and we
   do not. So they say, once, and the canvas obeys.

   The choice is a DEVICE setting, not a document one — it belongs to this
   machine and whatever is plugged into it — so it lives in localStorage beside
   the cockpit pins rather than in the design.

   PAN is the default, and the default matters more than it looks: whichever way
   it falls, one device is wrong until someone finds this control. It goes to
   the trackpad because the two costs aren't equal. A trackpad has no OTHER pan
   gesture — middle-drag needs a button it hasn't got, and hold-Space dies the
   moment focus enters the calibration field — so defaulting to zoom leaves it
   unable to cross a plan at all, which is what shipping the other way did. A
   mouse set to pan still zooms with cmd+wheel and still pans by middle-drag, so
   nothing is out of reach while its owner clicks the magnifier once. It is also
   what the pad expects from every other design tool: scroll moves the page,
   pinch is the zoom. */

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/shell/icon";
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
function writeWheelMode(v: WheelMode) {
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

/**
 * The toggle, which rides the front of the canvas's zoom HUD.
 *
 * Both states stay on screen rather than one button swapping its own icon: it
 * is a choice the user has to be able to SEE they made, and a single button
 * that shows either the current mode or the one it would switch to is
 * ambiguous whichever way you read it.
 */
export function WheelModeToggle({ value }: { value: WheelMode }) {
  return (
    <div className="ds-wheelmode" role="group" aria-label="Scroll wheel">
      {(["zoom", "pan"] as const).map((m) => (
        <button
          key={m}
          className={`ds-wheelbtn${value === m ? " on" : ""}`}
          aria-pressed={value === m}
          aria-label={m === "zoom" ? "Scroll to zoom" : "Scroll to pan"}
          title={
            m === "zoom"
              ? "Scrolling zooms the plan — for a mouse wheel"
              : "Scrolling moves across the plan — for a trackpad"
          }
          onClick={() => writeWheelMode(m)}
        >
          <Icon name={m === "zoom" ? "maximize" : "hand"} size={13} />
        </button>
      ))}
    </div>
  );
}
