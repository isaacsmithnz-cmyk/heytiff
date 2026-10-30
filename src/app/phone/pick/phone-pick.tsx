"use client";

import { useEffect, useRef, useState } from "react";

/* CHOOSING A PDF ON THE PHONE, for the Library. The app has no file picker of
   its own without a new install, and a web view has one in any file input, so
   the sheet's Choose a PDF button is this page. It says what was chosen, and
   when the app hands it a signed slot it puts that file there, as the web's
   drawer does. The app's sign-in never comes here: the slot is good for one
   object, and it's the only thing this page is given.

   Handed a slot:
   - in the app, by calling `window.heytiffPick` once the page says ready
     through the web view's bridge;
   - in a frame on this machine (the app's web build), by posting `{ heytiffPick }`. */

export type PickSlot = { bucket: string; ref: string; token: string };

type PickSaid =
  | { pick: "ready" }
  | { pick: "chosen"; name: string; size: number; type: string }
  | { pick: "sent" }
  | { pick: "failed"; error: string };

declare global {
  interface Window {
    heytiffPick?: (slot: PickSlot) => void;
    ReactNativeWebView?: { postMessage: (m: string) => void };
  }
}

const say = (m: PickSaid) => {
  window.ReactNativeWebView?.postMessage(JSON.stringify(m));
  if (window.parent !== window) window.parent.postMessage({ heytiffPick: m }, "*");
};

/** What a chosen file is: a phone's file manager may not say, and its name still does. Pure. */
export function typeOf(file: { name: string; type: string }): string {
  return file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
}

/** A slot this page will use: only the Library's bucket, only a manual's own place in it. Pure. */
export function isSlot(s: unknown): s is PickSlot {
  const o = s as Partial<PickSlot> | null;
  return !!o && o.bucket === "kb" && typeof o.token === "string" && !!o.token && typeof o.ref === "string" && /^org\/[^/]+\/kb\/[^/]+\.pdf$/.test(o.ref);
}

/** A frame may hand a slot only from this machine: on a phone, the app's bridge is the only way in. Pure. */
export function isOurFrame(origin: string): boolean {
  try {
    return new URL(origin).hostname === "localhost";
  } catch {
    return false;
  }
}

export function PhonePick() {
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const take = async (slot: PickSlot) => {
      const f = file.current;
      if (!f || !isSlot(slot)) return say({ pick: "failed", error: "That upload didn't finish." });
      setSending(true);
      const { supabaseBrowser } = await import("@/lib/supabase-browser");
      const { error } = await supabaseBrowser().storage.from(slot.bucket).uploadToSignedUrl(slot.ref, slot.token, f, { contentType: "application/pdf" });
      setSending(false);
      say(error ? { pick: "failed", error: "That upload didn't finish." } : { pick: "sent" });
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { heytiffPick?: PickSlot } | null;
      if (e.source === window.parent && isOurFrame(e.origin) && d && typeof d === "object" && d.heytiffPick) void take(d.heytiffPick);
    };
    window.heytiffPick = (slot) => void take(slot);
    window.addEventListener("message", onMessage);
    say({ pick: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      delete window.heytiffPick;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F4F4F5" }}>
      <button
        type="button"
        disabled={sending}
        onClick={() => input.current?.click()}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          border: 0,
          borderRadius: 12,
          background: "#2563EB",
          color: "#FFFFFF",
          font: "inherit",
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        Choose a PDF
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          file.current = f;
          say({ pick: "chosen", name: f.name, size: f.size, type: typeOf(f) });
        }}
      />
    </div>
  );
}
