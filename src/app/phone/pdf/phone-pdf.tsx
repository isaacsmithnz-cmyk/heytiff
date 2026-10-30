"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { openSigned } from "./load-pdf";

/* THE PHONE'S MANUAL (Isaac, 30 October 2026, the manual screen's three
   ways, "B is good"): the manual itself under its search, its pages
   scrolling as in a PDF reader, two fingers to zoom. A search result moves
   it to its page with the words outlined.

   The page reads nothing, no session and no workspace. The app fetches the
   manual's short-lived link with its own token (api/mobile/library/[id]/file)
   and hands it in, with the page to show and the words to outline:
   - in the app, by calling `window.heytiffPdf` once the page says ready
     through the web view's bridge;
   - in a frame (the app's web build), by posting `{ heytiffPdf }`.
   It says back which page is on screen and how many there are. Only a link
   into HeyTiff's own storage is read, so a stranger handing it anything
   else is shown nothing. */

export type PdfPosted = { url?: string; page?: number; marks?: string[] };
export type PdfSaid = { pdf: "ready" } | { pdf: "at"; page: number; pages: number } | { pdf: "failed" };

declare global {
  interface Window {
    heytiffPdf?: (p: PdfPosted) => void;
    ReactNativeWebView?: { postMessage: (m: string) => void };
  }
}

/** A signed link into HeyTiff's own storage, and nothing else. Pure but for the env. */
export function isOurs(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!base && url.startsWith(`${base}/storage/v1/object/sign/`);
}

/** Where a word sits on its page, as fractions of the page. */
export type Box = { left: number; top: number; width: number; height: number };
type TextBit = { str?: string; transform?: number[]; width?: number };

/** pdf.js's Util.transform: one matrix after another. Pure. */
const times = (m: number[], t: number[]) => [
  m[0]! * t[0]! + m[2]! * t[1]!,
  m[1]! * t[0]! + m[3]! * t[1]!,
  m[0]! * t[2]! + m[2]! * t[3]!,
  m[1]! * t[2]! + m[3]! * t[3]!,
  m[0]! * t[4]! + m[2]! * t[5]! + m[4]!,
  m[1]! * t[4]! + m[3]! * t[5]! + m[5]!,
];

/** The outlines for the words searched, on a page's own text: each place a
    run of text says one, the run's share of its width where the word falls.
    Text a drawing was read into has no run on the page, so it has no
    outline. Pure. */
export function boxesOf(items: readonly unknown[], marks: readonly string[], page: { transform: number[]; width: number; height: number }): Box[] {
  const words = [...new Set(marks.map((m) => m.trim().toLowerCase()).filter((m) => m.length >= 2))];
  const out: Box[] = [];
  for (const it of items as TextBit[]) {
    if (!it.str || !it.transform) continue;
    const t = times(page.transform, it.transform);
    /* runs set across the page; a run turned on its side isn't outlined */
    if (Math.abs(t[1]!) > Math.abs(t[0]!)) continue;
    const s = it.str.toLowerCase();
    const h = Math.hypot(t[2]!, t[3]!);
    const w = it.width ?? 0;
    for (const word of words) {
      for (let at = s.indexOf(word); at >= 0 && out.length < 60; at = s.indexOf(word, at + word.length)) {
        const x = t[4]! + (w * at) / s.length;
        out.push({ left: x / page.width, top: (t[5]! - h) / page.height, width: (w * word.length) / s.length / page.width, height: h / page.height });
      }
    }
  }
  return out;
}

const say = (m: PdfSaid) => {
  window.ReactNativeWebView?.postMessage(JSON.stringify(m));
  if (window.parent !== window) window.parent.postMessage({ heytiffPdf: m }, "*");
};

/** The most pixels a page is drawn with, zoomed in: about 24 MB of picture. */
const MOST_PIXELS = 6_000_000;

export function PhonePdf() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  /* each page's height over its width: the first page's until it's read */
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [first, setFirst] = useState(1.414);
  const [near, setNear] = useState<Set<number>>(new Set());
  const [sharp, setSharp] = useState(1);
  /* where the app asked to go: a new `n` goes there again */
  const [want, setWant] = useState<{ page: number; marks: string[]; n: number } | null>(null);
  /* the last of those whose words were brought into view, so a page drawn again doesn't pull you back */
  const [shown, setShown] = useState(0);
  const url = useRef<string | null>(null);
  const asked = useRef(0);
  const sheets = useRef(new Map<number, HTMLDivElement>());

  const lost = useCallback(() => {
    setFailed(true);
    say({ pdf: "failed" });
  }, []);

  /* the handshake: ready, then whatever the app hands in */
  useEffect(() => {
    const take = (p: PdfPosted) => {
      if (typeof p.url === "string" && p.url !== url.current) {
        url.current = p.url;
        setDoc(null);
        setFailed(false);
        if (!isOurs(p.url)) return lost();
        void openSigned(p.url, lost).then(async (d) => {
          if (url.current !== p.url) return;
          const one = (await d.getPage(1)).getViewport({ scale: 1 });
          setFirst(one.height / one.width);
          setDoc(d);
        }, lost);
      }
      if (typeof p.page === "number" || Array.isArray(p.marks)) {
        setWant({ page: Math.max(1, Math.floor(p.page ?? 1)), marks: (p.marks ?? []).filter((m) => typeof m === "string").slice(0, 12), n: ++asked.current });
      }
    };
    const onMessage = (e: MessageEvent) => {
      const d: unknown = e.data;
      if (d && typeof d === "object" && "heytiffPdf" in d && typeof d.heytiffPdf === "object" && d.heytiffPdf) take(d.heytiffPdf as PdfPosted);
    };
    window.heytiffPdf = take;
    window.addEventListener("message", onMessage);
    say({ pdf: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      if (window.heytiffPdf === take) delete window.heytiffPdf;
    };
  }, [lost]);

  const pages = doc?.numPages ?? 0;

  /* zoomed in, the pages are drawn again sharper once the fingers stop */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => setSharp(Math.max(1, Math.min(4, Math.round(vv.scale * 2) / 2))), 250);
    };
    vv.addEventListener("resize", on);
    return () => {
      clearTimeout(t);
      vv.removeEventListener("resize", on);
    };
  }, []);

  /* as it scrolls: the page in view, said to the app as it changes, and the
     pages within a screen and a half of it drawn, the rest left blank paper */
  useEffect(() => {
    if (!pages) return;
    let shown = 0;
    let drawn = "";
    const look = () => {
      const tall = window.innerHeight;
      let at = 1;
      const close: number[] = [];
      for (const [n, el] of sheets.current) {
        const r = el.getBoundingClientRect();
        if (r.top <= tall * 0.4 && n > at) at = n;
        if (r.bottom > -1.5 * tall && r.top < 2.5 * tall) close.push(n);
      }
      if (at !== shown) say({ pdf: "at", page: (shown = at), pages });
      const key = close.sort((a, b) => a - b).join(",");
      if (key === drawn) return;
      drawn = key;
      setNear(new Set(close));
    };
    look();
    window.addEventListener("scroll", look, { passive: true });
    window.addEventListener("resize", look);
    return () => {
      window.removeEventListener("scroll", look);
      window.removeEventListener("resize", look);
    };
  }, [pages]);

  /* asked for a page: there */
  useEffect(() => {
    if (!want || !pages) return;
    sheets.current.get(Math.min(want.page, pages))?.scrollIntoView({ block: "start" });
    /* drawn there now, not when the browser next gets round to saying it scrolled */
    window.dispatchEvent(new Event("scroll"));
  }, [want, pages]);

  const ratioOf = useCallback((n: number, r: number) => setRatios((was) => (was[n] === r ? was : { ...was, [n]: r })), []);

  if (failed) return <p style={{ margin: 24, font: "15px/22px system-ui, sans-serif", color: "#5f6a79" }}>This manual couldn&apos;t be opened here.</p>;
  return (
    <div style={{ minHeight: "100vh", background: "#dcdce1", padding: "10px 12px 24px", display: "grid", gap: 10, alignContent: "start", overflowAnchor: "auto" }}>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          data-n={n}
          ref={(el) => {
            if (el) sheets.current.set(n, el);
            else sheets.current.delete(n);
          }}
          style={{ position: "relative", aspectRatio: `1 / ${ratios[n] ?? first}`, background: "#fff", boxShadow: "0 1px 6px rgba(5,5,5,.14)", overflow: "hidden" }}
        >
          {doc && near.has(n) ? (
            <Sheet
              doc={doc}
              n={n}
              sharp={sharp}
              marks={want && want.page === n ? want.marks : null}
              focus={want && want.page === n && want.n > shown ? want.n : 0}
              onFocused={setShown}
              onRatio={ratioOf}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** One page drawn, with the words searched outlined on it. */
function Sheet({
  doc,
  n,
  sharp,
  marks,
  focus,
  onFocused,
  onRatio,
}: {
  doc: PDFDocumentProxy;
  n: number;
  sharp: number;
  marks: string[] | null;
  focus: number;
  onFocused: (n: number) => void;
  onRatio: (n: number, r: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [read, setRead] = useState<{ said: string; boxes: Box[] }>({ said: "", boxes: [] });

  useEffect(() => {
    let live = true;
    let task: RenderTask | null = null;
    void doc
      .getPage(n)
      .then((p) => {
        const el = canvas.current;
        if (!live || !el) return;
        const base = p.getViewport({ scale: 1 });
        onRatio(n, base.height / base.width);
        const across = (el.parentElement?.clientWidth ?? window.innerWidth) * (window.devicePixelRatio || 1) * sharp;
        const scale = Math.min(across / base.width, Math.sqrt(MOST_PIXELS / (base.width * base.height)));
        const viewport = p.getViewport({ scale });
        el.width = Math.round(viewport.width);
        el.height = Math.round(viewport.height);
        task = p.render({ canvas: el, canvasContext: el.getContext("2d")!, viewport });
        return task.promise;
      })
      .catch(() => undefined);
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, n, sharp, onRatio]);

  const said = marks?.join("\u0000") ?? "";
  const boxes = said && read.said === said ? read.boxes : [];
  useEffect(() => {
    if (!said) return;
    let live = true;
    void doc
      .getPage(n)
      .then(async (p) => {
        const viewport = p.getViewport({ scale: 1 });
        const { items } = await p.getTextContent();
        if (live) setRead({ said, boxes: boxesOf(items, said.split("\u0000"), viewport) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [doc, n, said]);

  /* asked for this page with words on it: the first of them brought into view */
  useEffect(() => {
    const el = canvas.current?.parentElement;
    const b = said && read.said === said ? read.boxes[0] : undefined;
    if (!focus || !el || !b) return;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top + b.top * el.clientHeight - window.innerHeight * 0.3 });
    onFocused(focus);
  }, [focus, read, said, onFocused]);

  return (
    <>
      <canvas ref={canvas} style={{ display: "block", width: "100%", height: "100%" }} />
      {boxes.map((b, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `calc(${b.left * 100}% - 3px)`,
            top: `calc(${b.top * 100}% - 2px)`,
            width: `calc(${b.width * 100}% + 6px)`,
            height: `calc(${b.height * 100}% + 4px)`,
            border: "2px solid #f97316",
            borderRadius: 3,
          }}
        />
      ))}
    </>
  );
}
