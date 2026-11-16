"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";
import { useToast } from "@/components/parts/toast";
import { pageName, pageNamesSnapshot } from "./page-names";

/* REPORT BUG, ON THE WEBSITE (Isaac, 17 November 2026: "Yes, build it" to
   https://claude.ai/artifact/V6XVjpPn7qFmdt3JVxELhL). The phone's bug, in
   Your name, for the owner alone; lib/mobile/bugs says what a bug is and
   where it's kept.

   Report bug closes the menu and the page draws its own picture, as it was,
   and the dialog shows that picture, so you see exactly what goes with the
   bug. Its number is held as the dialog opens; Cancel gives it back.

   When the picture doesn't show it, Add a screenshot puts the dialog away,
   so it isn't in your screenshot (Isaac, 16 November 2026: "If they
   screenshot, the modal will be in the way"). The page is yours again, and
   a grey bar where toasts go says the keys for your computer: a screenshot
   that lands on the clipboard, so pasting it brings the dialog back with it
   in place of the page's picture. Choose file takes one you already have,
   and a picture dropped on the page does too. Report bug saves it, and the
   toast says its number, with Undo. */

/** The keys for a screenshot that lands on the clipboard, on the computer you're on. */
export function screenshotKeys(platform: string): string {
  if (/mac|iphone|ipad/i.test(platform)) return "Press ⌘ Control Shift 4 and drag over the problem. Then press ⌘ V.";
  if (/win/i.test(platform)) return "Press Windows Shift S and drag over the problem. Then press Ctrl V.";
  return "Take a screenshot of the problem. Then press Ctrl V.";
}

/** The first picture among what was pasted, dropped or chosen. */
export function pictureIn(files: ArrayLike<File> | null | undefined): File | null {
  for (const f of Array.from(files ?? [])) if (f.type.startsWith("image/")) return f;
  return null;
}

/** What the dialog says it's of: the bug's number, and the page's name where the page gave one. */
export function bugUnder(n: number, where: string | null): string {
  return where ? `Bug ${n}, on ${where}` : `Bug ${n}`;
}

const platformOf = () => (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;

/** Two frames: the menu that was open is gone from the screen before the page draws itself. */
const twoFrames = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

/** The page as it is on the screen, scrolled where it's scrolled. */
async function drawPage(): Promise<Blob | null> {
  const { domToBlob } = await import("modern-screenshot");
  const body = document.body;
  return domToBlob(body, {
    width: window.innerWidth,
    height: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    type: "image/png",
    backgroundColor: getComputedStyle(body).backgroundColor,
    features: { restoreScrollPosition: true },
  });
}

/** Every bug is a .png: a JPEG or a GIF is drawn again as one. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("no png"))), "image/png"));
}

type Sent<T> = { ok: true; value: T } | { ok: false; error: string };

async function send<T>(url: string, method: string, body?: unknown): Promise<Sent<T>> {
  try {
    const r = await fetch(url, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true, value: j as T } : { ok: false, error: j.error ?? "Couldn't save the bug." };
  } catch {
    return { ok: false, error: "Couldn't reach HeyTiff. Try again." };
  }
}

type Held = { number: number; path: string; token: string; where: string | null };
type Shot = { blob: Blob; url: string };
type Stage = "drawing" | "open" | "aside" | "saving";

/** Report bug: `begin` from the menu, and `view`, the dialog and the bar, drawn beside it. */
export function useReportBug(): { begin: () => void; view: ReactNode } {
  const toast = useToast();
  const [stage, setStage] = useState<Stage | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [page, setPage] = useState<Shot | null>(null);
  const [theirs, setTheirs] = useState<Shot | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* a second press while the page draws, or a second Report bug, is the same one */
  const busy = useRef(false);
  /* the picture already in storage: a retry after the note failed doesn't send it twice */
  const uploaded = useRef<Blob | null>(null);
  const chooser = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (page) URL.revokeObjectURL(page.url);
    if (theirs) URL.revokeObjectURL(theirs.url);
    setStage(null);
    setHeld(null);
    setPage(null);
    setTheirs(null);
    setNote("");
    setError(null);
    busy.current = false;
    uploaded.current = null;
  };

  const begin = async () => {
    if (busy.current) return;
    busy.current = true;
    setStage("drawing");
    await twoFrames();
    const href = window.location.pathname + window.location.search;
    const where = pageName(pageNamesSnapshot(), href)?.label ?? null;
    const [blob, res] = await Promise.all([
      drawPage().catch((e: unknown) => {
        console.error("[bug] the page didn't draw", e);
        return null;
      }),
      send<{ number: number; path: string; token: string }>("/api/bugs", "POST", { page: where ? `${where}, ${href}` : href }),
    ]);
    if (!res.ok) {
      busy.current = false;
      setStage(null);
      toast({ text: res.error });
      return;
    }
    setHeld({ number: res.value.number, path: res.value.path, token: res.value.token, where });
    if (blob) setPage({ blob, url: URL.createObjectURL(blob) });
    setStage("open");
  };

  /** Your screenshot, in place of the page's picture. */
  const take = async (file: Blob) => {
    try {
      const png = await asPng(file);
      if (theirs) URL.revokeObjectURL(theirs.url);
      setTheirs({ blob: png, url: URL.createObjectURL(png) });
      setError(null);
    } catch {
      setError("That file isn't a picture HeyTiff can read.");
    }
    setStage("open");
  };

  const backToPagePicture = () => {
    if (theirs) URL.revokeObjectURL(theirs.url);
    setTheirs(null);
  };

  /* while the dialog is open or put away: a pasted or dropped picture is yours */
  const listening = stage === "open" || stage === "aside";
  useEffect(() => {
    if (!listening) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = pictureIn(e.clipboardData?.files);
      if (!f) return;
      e.preventDefault();
      void take(f);
    };
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      /* a file dropped on the page is never opened in place of it */
      e.preventDefault();
      const f = pictureIn(e.dataTransfer?.files);
      if (f) void take(f);
      else setError("Drop a picture: a PNG or a JPEG.");
    };
    const onKey = (e: KeyboardEvent) => {
      if (stage === "aside" && e.key === "Escape") setStage("open");
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKey);
    };
  });

  const cancel = () => {
    if (stage === "saving") return;
    if (held) void send(`/api/bugs/${held.number}`, "DELETE");
    reset();
  };

  const save = async () => {
    if (!held || stage === "saving") return;
    setStage("saving");
    setError(null);
    const pic = theirs?.blob ?? page?.blob ?? null;
    if (pic && uploaded.current !== pic) {
      try {
        const { supabaseBrowser } = await import("@/lib/supabase-browser");
        // the documents bucket (lib/documents/query), where the phone's bugs are
        const { error: upErr } = await supabaseBrowser().storage.from("documents").uploadToSignedUrl(held.path, held.token, pic, { contentType: "image/png" });
        if (upErr) throw new Error(upErr.message);
        uploaded.current = pic;
      } catch (e) {
        console.error("[bug] the picture didn't save", e);
        setError("The picture didn't save. Try again.");
        setStage("open");
        return;
      }
    }
    if (note.trim()) {
      const r = await send(`/api/bugs/${held.number}`, "PUT", { note });
      if (!r.ok) {
        setError(r.error);
        setStage("open");
        return;
      }
    }
    const n = held.number;
    reset();
    toast({ text: `Bug ${n} saved`, undo: () => void send(`/api/bugs/${n}`, "DELETE") });
  };

  const saving = stage === "saving";
  const shown = theirs ?? page;
  const view = (
    <>
      <input
        ref={chooser}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = pictureIn(e.target.files);
          e.target.value = "";
          if (f) void take(f);
        }}
      />
      <Dialog
        open={stage === "open" || saving}
        heading="Report bug"
        under={held ? bugUnder(held.number, held.where) : undefined}
        onClose={cancel}
        width={560}
        dismissable={false}
        foot={
          <>
            <Button onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button kind="main" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving" : "Report bug"}
            </Button>
          </>
        }
      >
        <div className="rb-body">
          <div className="rb-shot">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- a picture drawn in the browser, never served
              <img className="rb-pic" src={shown.url} alt={theirs ? "Your screenshot" : "The page, as it was"} />
            ) : (
              <p className="rb-none">The page couldn&apos;t draw its picture. Add a screenshot instead.</p>
            )}
            {theirs && page ? (
              <Button kind="quiet" size={32} onClick={backToPagePicture} disabled={saving}>
                Use the page&apos;s picture
              </Button>
            ) : (
              <Button kind="quiet" size={32} icon="upload" onClick={() => setStage("aside")} disabled={saving}>
                Add a screenshot
              </Button>
            )}
          </div>
          <Field label="What's wrong?">
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} data-autofocus />
          </Field>
          {error && (
            <p className="pt-field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      {stage === "aside" &&
        createPortal(
          <div className="pt-toasts" role="status">
            <div className="pt-toast">
              <span className="pt-toast-text">{screenshotKeys(platformOf())}</span>
              <button type="button" className="pt-toast-undo" onClick={() => chooser.current?.click()}>
                Choose file
              </button>
              <button type="button" className="pt-toast-undo" onClick={() => setStage("open")}>
                Back
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );

  return { begin: () => void begin(), view };
}
