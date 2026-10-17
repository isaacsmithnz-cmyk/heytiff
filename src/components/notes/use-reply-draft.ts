"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { DRAFT_PAUSE_MS, type DraftBox } from "@/lib/drafts/drafts";

/* A reply box that keeps what you typed and haven't sent (Isaac, 2026-10-18:
   "How can we make it save? The text in the reply box. Before sending").

   The words go to the server about a second after the typing stops, and
   again the moment you leave the page, so they're there on the next device
   you open the quote on. Coming back, they're put in the box as you left
   them, unless you've already started typing. Emptying the box, or sending,
   removes the draft (the send route clears it too, whichever device sends).
   A draft that can't be kept says nothing: the words are still on screen. */

const ROUTE = "/api/drafts";

type Pending = { box: DraftBox; ref: string; text: string };

const put = (p: Pending) =>
  fetch(ROUTE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p), keepalive: true }).catch(() => null);

export function useReplyDraft(box: DraftBox, ref: string, typed: string, restore: (text: string) => void, enabled = true) {
  /* the draft is read before anything is written: an empty box on load must
     never write over the words waiting on the server */
  const ready = useRef(false);
  /* what the server holds, as far as this page knows */
  const kept = useRef("");
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    kept.current = p.text;
    void put(p);
  };

  const restoreNow = useEffectEvent((text: string) => restore(text));
  useEffect(() => {
    ready.current = false;
    kept.current = "";
    if (!enabled || !ref) return;
    let live = true;
    void fetch(`${ROUTE}?box=${box}&ref=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((v: { ok?: boolean; text?: unknown } | null) => {
        if (!live) return;
        const text = v?.ok && typeof v.text === "string" ? v.text : "";
        kept.current = text;
        if (text) restoreNow(text);
      })
      .catch(() => null)
      .finally(() => {
        if (live) ready.current = true;
      });
    return () => {
      live = false;
    };
  }, [box, ref, enabled]);

  useEffect(() => {
    if (!enabled || !ref || !ready.current) return;
    const text = typed.trim() ? typed : "";
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text === kept.current) {
      pending.current = null;
      return;
    }
    pending.current = { box, ref, text };
    timer.current = setTimeout(flush, DRAFT_PAUSE_MS);
  }, [typed, box, ref, enabled]);

  /* leaving the page, or the quote, writes what's waiting at once */
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [box, ref]);
}
