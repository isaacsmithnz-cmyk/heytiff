"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import type { DiaryFeed } from "@/lib/dashboard/diary-feed";
import { DIARY_RECHECK_MS, mirrorStale, pageStale } from "@/lib/dashboard/diary-refresh";

/* THE DIARY ASKS FOR THE PAGE AGAIN — lib/dashboard/diary-refresh says
   when, and why: a minute after it opens on a stale copy of ServiceM8, and
   when you come back to the tab to a page more than ten minutes old; never
   while Tiff is open, but as soon as she closes. Only for a diary that
   reads ServiceM8. The clock is read in the effects and the handlers,
   never in render. */
export function useDiaryRefresh(feed: DiaryFeed): void {
  const router = useRouter();
  const { isOpen } = useTiff();
  const reads = feed.mentions;

  /* When the page on screen was loaded: when the diary first shows, and
     again each time a new page comes in. */
  const loadedAt = useRef<number | null>(null);
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [feed]);

  /* Asked for while Tiff is open, it waits for her to close. One asking
     for the whole life of the diary, so nothing below starts its clock
     again because something else drew. */
  const routerNow = useRef(router);
  useEffect(() => {
    routerNow.current = router;
  }, [router]);
  const tiffOpen = useRef(isOpen);
  const waiting = useRef(false);
  const ask = useCallback(() => {
    if (tiffOpen.current) {
      waiting.current = true;
      return;
    }
    waiting.current = false;
    routerNow.current.refresh();
  }, []);
  useEffect(() => {
    tiffOpen.current = isOpen;
    if (!isOpen && waiting.current) ask();
  }, [isOpen, ask]);

  /* A minute after it opens, when the copy it opened on was stale: what
     the page drew it from, as it was then. */
  const [opened] = useState(() => ({ reads, syncedAt: feed.syncedAt }));
  useEffect(() => {
    if (!opened.reads || !mirrorStale(opened.syncedAt, Date.now())) return;
    const t = setTimeout(ask, DIARY_RECHECK_MS);
    return () => clearTimeout(t);
  }, [opened, ask]);

  /* Back to the tab, to a page more than ten minutes old. Once for one
     return: the page it asked for is on its way. */
  useEffect(() => {
    if (!reads) return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      const at = loadedAt.current;
      const now = Date.now();
      if (at === null || !pageStale(at, now)) return;
      loadedAt.current = now;
      ask();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [reads, ask]);
}
