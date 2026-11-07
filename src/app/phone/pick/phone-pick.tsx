"use client";

import { useEffect, useRef, useState } from "react";

/* CHOOSING A PDF ON THE PHONE, for the Library. The app has no file picker of
   its own without a new install, and a web view has one in any file input, so
   the sheet's Choose a PDF button is this page. It says what was chosen, and
   when the app hands it a signed slot it puts that file there, as the web's
   drawer does, and says how much of it has gone (Isaac, 31 October 2026: "It
   should probably have a loading bar to show how close it is"). The app's
   sign-in never comes here: the slot is good for one object, and it's the only
   thing this page is given.

   Handed a slot:
   - in the app, by calling `window.heytiffPick` once the page says ready
     through the web view's bridge;
   - in a frame on this machine (the app's web build), by posting `{ heytiffPick }`. */

export type PickSlot = { bucket: string; ref: string; token: string };

type PickSaid =
  | { pick: "ready" }
  | { pick: "chosen"; name: string; size: number; type: string }
  | { pick: "progress"; sent: number; total: number }
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

/** `fetch` by way of an XMLHttpRequest, the one way a browser says how much of an upload has gone. Supabase's
    client still builds the request, so it's the same upload as ever. */
export function fetchSaying(gone: (loaded: number, total: number) => void): typeof fetch {
  return (input, init) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(init?.method ?? "GET", typeof input === "object" && "url" in input ? input.url : String(input));
      new Headers(init?.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) gone(e.loaded, e.total);
      };
      xhr.onload = () => {
        const headers = { "content-type": xhr.getResponseHeader("content-type") ?? "" };
        resolve(new Response([204, 205, 304].includes(xhr.status) ? null : xhr.responseText, { status: xhr.status, headers }));
      };
      xhr.onerror = xhr.onabort = xhr.ontimeout = () => reject(new TypeError("The upload stopped."));
      xhr.send(init?.body as XMLHttpRequestBodyInit | null | undefined);
    });
}

const SAY_EVERY_MS = 250;

export function PhonePick() {
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const take = async (slot: PickSlot) => {
      const f = file.current;
      if (!f || !isSlot(slot)) return say({ pick: "failed", error: "That upload didn't finish." });
      setSending(true);
      /* a form's part takes its type from the file, not from `contentType`, and a phone's file manager may not say one */
      const pdf = f.type === "application/pdf" ? f : new File([f], f.name, { type: "application/pdf" });
      let said = 0;
      const gone = (loaded: number, total: number) => {
        if (loaded < total && Date.now() - said < SAY_EVERY_MS) return;
        said = Date.now();
        /* of the form it's sent in, which is a little more than the file */
        say({ pick: "progress", sent: Math.round((f.size * loaded) / total), total: f.size });
      };
      const { supabaseBrowser } = await import("@/lib/supabase-browser");
      const { error } = await supabaseBrowser(fetchSaying(gone)).storage.from(slot.bucket).uploadToSignedUrl(slot.ref, slot.token, pdf, { contentType: "application/pdf" });
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
