"use client";

import { Fade } from "@/components/parts/fade";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOverlay } from "@/components/overlay/use-overlay";
import { Button, IconButton } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { clamp } from "@/lib/studio/geometry";
import {
  anchoredScroll,
  readPhotoWheel,
  type PhotoWheelState,
} from "@/lib/workboard/photo-zoom";
import type { JobMediaItem } from "@/lib/workboard/job-media";

/* THE ONE VIEWER — every photo and PDF on the job card opens here, instead
   of a raw storage URL in a new browser tab that loses the job.

   ASSEMBLY, NOT INVENTION: the portal law and prev/next shape are the
   Studio plan lightbox's; the scroll-lock-with-restore is the notices
   lightbox's; the wheel reader and clamp are the Studio's own pure modules.
   A PDF cheats like the reference viewer — an iframe inherits the browser's
   paging and zoom for free.

   NOT A SEPARATE PORTAL. Renders inside the sheet's own portal, over the
   card, exactly like the claim modal — a modal on a modal that portals
   separately is how a scrim ends up above the thing it dims. ESCAPE IS THE
   SHEET'S: the card's own keydown chain closes the viewer first (innermost
   first), so this component binds only the arrow keys.

   WHITE, LIKE EVERY DIALOG (rule 36; the mock of 25 October 2026, frame
   14): white, the 16 corner and the one shadow over the darkened page. The
   head says what the file is (its name, its date and where it came from,
   "1 of 3"), then what can be done to it — the acts a document row carried
   on its right until v2 (Remove, Revise, Reissue, Use renewal, Delete), so
   each row keeps one thing there — then Star on a photo, then the cross.
   What ends something is the red word, and asks first. The picture sits on a
   soft grey stage with Previous and Next as words on it, and the roll of the
   others underneath.

   ON TOP BY LAYER AND ORDER. The pair shares the sheet's modal layer and
   renders after the card, and at an equal z-index the later element paints
   on top; the toasts stay above. jsdom cannot see a stacking context, so
   the painting was walked in a browser; the layer is held by
   sheet-overlay-layers.test.ts and the order by the job card's tests. */

/* THE FLOOR IS THE FIT, NOT A NUMBER (Isaac, 2026-08-29). There is no reason
   to shrink a photo below the size the stage can show it at — the only thing
   under `fit` is a smaller picture in more black. So the wheel and the
   double-click both clamp DOWN to whatever fit currently is, and zooming out
   past it lands back on the CSS fit rather than on a stamp.

   Which means there is no ZOOM_MIN constant any more: fit is a measurement,
   not a constant, and it changes with the stage and the photo. */
const ZOOM_MAX = 12;

/** The scale at which this photo exactly fits the stage — the same number the
    CSS reaches by `object-fit:contain`, computed here because the wheel needs
    to know where it is. Upscales as well as down: a small photo fits by
    growing. 1 when the photo hasn't reported its size yet. */
function fitScale(
  stage: { clientWidth: number; clientHeight: number },
  nat: { w: number; h: number } | null,
): number {
  if (!nat || nat.w <= 0 || nat.h <= 0) return 1;
  /* 2 × the stage's 20px inset — .wb2-mvpane img in shell.css. The two
     numbers are one fact written twice: this is what makes the wheel's
     zoom-out floor land exactly on the CSS fit. */
  const pad = 40;
  return Math.min(
    (stage.clientWidth - pad) / nat.w,
    (stage.clientHeight - pad) / nat.h,
  );
}

/** One act in the viewer's head: what a document row offered on its right
    until v2. `run` resolves null once it is done, or with the reason it
    wasn't, in words; one that `closes` shuts the viewer when it lands (the
    file it showed has gone). */
export type ViewerAct = {
  key: string;
  /** A verb, as the row said it: "Remove", "Revise", "Use renewal". */
  label: string;
  /** Ends something: the red word on the second button (rule 25). */
  danger?: boolean;
  /** Asks first, naming what the second press does. */
  confirm?: {
    heading: string;
    body?: string;
    confirm: string;
    cancel?: string;
  };
  /** What the button says while its work is out. */
  busyLabel?: string;
  closes?: boolean;
  run: () => Promise<string | null> | void;
};

export function JobMediaViewer({
  items,
  index,
  favourites,
  onNav,
  onStar,
  onClose,
  actions = [],
  line,
}: {
  /** The lens's own list — photos in day order, or one document. */
  items: readonly JobMediaItem[];
  index: number;
  /** Starred attachment ids. Null for paper and until the read lands — the
      showcase is a gallery of the work, so a PDF simply has no star. */
  favourites?: ReadonlySet<string> | null;
  onNav: (index: number) => void;
  onStar?: (remoteId: string) => void;
  onClose: () => void;
  /** What can be done to the file on show, in the head. */
  actions?: readonly ViewerAct[];
  /** The grey line under the name, when the file's date and origin don't
      say it (a licence: whose, and how long it runs). */
  line?: string | null;
}) {
  const item = items[index];
  /* The act that is asking, the one whose work is out, and why the last one
     didn't land. */
  const [asking, setAsking] = useState<ViewerAct | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (act: ViewerAct) => {
    setAsking(null);
    setErr(null);
    setBusy(act.key);
    const why = await Promise.resolve(act.run()).catch(
      () => "That didn't work. Try again.",
    );
    setBusy(null);
    if (why) setErr(why);
    else if (act.closes) onClose();
  };
  const stageRef = useRef<HTMLDivElement>(null);
  const currentThumbRef = useRef<HTMLButtonElement>(null);
  /* Zoom and natural size are KEYED BY INDEX — navigating simply leaves the
     old entry behind, so there is no reset effect to cascade a render. null
     zoom = fit the stage by pure CSS. */
  const [zoomState, setZoomState] = useState<{
    index: number;
    z: number;
  } | null>(null);
  const [natural, setNatural] = useState<{
    index: number;
    w: number;
    h: number;
  } | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const zoom = zoomState?.index === index ? zoomState.z : null;
  const nat = natural?.index === index ? natural : null;

  /* THE WHEEL LISTENER READS THE NATURAL SIZE THROUGH A REF, and binds once
     per photo rather than once per zoom step. Re-binding on every step would
     tear down and re-add a listener sixty times during one trackpad flick,
     and the gesture state the reader keeps is the only thing holding that
     interaction together. Nothing is lost by reading it late: this is set
     once, when the image loads, long before any wheel arrives. */
  const natRef = useRef(nat);
  useEffect(() => {
    natRef.current = nat;
  }, [nat]);

  /* Escape closes the viewer and only the viewer, whichever host opened it
     (the overlay stack). The arrow keys walk the lens. */
  const dialog = useRef<HTMLDivElement>(null);
  useOverlay(dialog, { onEscape: onClose });
  /* It takes focus on the way in, as the Dialog part does, so Tab goes round
     inside it from the first press. */
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.contains(document.activeElement))
      el.focus({ preventScroll: true });
  }, []);
  /* The arrows walk the lens, unless the question over it is open. */
  const askingNow = asking !== null;
  useEffect(() => {
    if (askingNow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < items.length - 1) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, items.length, onNav, askingNow]);

  /* Body scroll locked while open, restored on close — and the leftward pan
     must not become Chrome's swipe-back, which preventDefault cannot stop
     once the gesture is in its momentum phase. */
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = document.documentElement;
    const prevOverscroll = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      root.style.overscrollBehaviorX = prevOverscroll;
    };
  }, []);

  /* The strip follows the arrows: whichever way you move — key, arrow
     button or thumbnail — the open photo stays visible in the strip.
     scrollIntoView is optional-called; jsdom does not implement it. */
  useEffect(() => {
    currentThumbRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "center",
    });
  }, [index]);

  const isPdf = (item?.fileType ?? "").toLowerCase().endsWith("pdf");

  /* THE WHEEL. A NATIVE listener, passive:false — React 17+ binds onWheel
     passively at the root, so a JSX handler's preventDefault is silently
     dead and the page scrolls under the zoom (the canvas learned this
     first). Momentum events are non-cancelable; skip those.

     WHAT an event means is decided in lib/workboard/photo-zoom, which is
     where the trackpad reasoning lives and where it can be replayed by a
     test. Two answers come back:

       zoom   scale, and anchor under the pointer
       spent  do nothing: this gesture has already had its budget, and
              swallowing the rest of a momentum tail is the whole point

     Either way the event is consumed — panning a zoomed photo is the DRAG's
     job (below), not the wheel's. */
  const gesture = useRef<PhotoWheelState | null>(null);
  const anchor = useRef<{ x: number; y: number; ratio: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isPdf) return;
    const onWheel = (e: WheelEvent) => {
      const read = readPhotoWheel(e, e.timeStamp, gesture.current);
      gesture.current = read.state;
      if (e.cancelable) e.preventDefault();
      if (read.gesture.kind === "spent") return;

      const factor = read.gesture.factor;
      const rect = stage.getBoundingClientRect();
      setZoomState((prev) => {
        const cur = prev?.index === index ? prev.z : null;
        /* The fit must match the CSS or the first notch jumps — the stage
           fits by object-fit:contain, so this upscales too. */
        const fit = fitScale(stage, natRef.current);
        const from = cur ?? fit;
        const next = clamp(from * factor, fit, ZOOM_MAX);
        /* Back at the floor: hand the photo to the CSS again, so it is
           centred and contained rather than a scroll container with nothing
           to scroll. The epsilon is for the wheel's fractional factors. */
        if (next <= fit * 1.001) return null;
        anchor.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          ratio: next / from,
        };
        return { index, z: next };
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [isPdf, index]);

  /* Put the scroll where the anchor says, BEFORE the browser paints the new
     size — in an effect that runs after the commit, because the widths this
     is computed against only exist once React has written them. */
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const stage = stageRef.current;
    if (!a || !stage) return;
    const next = anchoredScroll(
      { left: stage.scrollLeft, top: stage.scrollTop },
      { x: a.x, y: a.y },
      a.ratio,
    );
    stage.scrollLeft = next.left;
    stage.scrollTop = next.top;
  }, [zoom]);

  if (!item) return null;

  /* Double-click is the shortcut to 1:1 — but never BELOW the fit. On a photo
     whose pixels are smaller than the stage, "actual size" is smaller than
     fit, and jumping to it would be the zooming-out this no longer does. */
  const onDoubleClick = () => {
    if (isPdf) return;
    if (zoom !== null) {
      setZoomState(null);
      return;
    }
    const stage = stageRef.current;
    const fit = stage ? fitScale(stage, nat) : 1;
    setZoomState(1 > fit ? { index, z: 1 } : null);
  };

  /* Drag pans a zoomed image — the stage is the scroller. */
  const onPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || zoom === null) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    const d = dragRef.current;
    if (!stage || !d) return;
    stage.scrollLeft = d.left - (e.clientX - d.x);
    stage.scrollTop = d.top - (e.clientY - d.y);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const when = item.takenAt
    ? [
        fmtAuWeekdayDayMonth(item.takenAt.slice(0, 10)),
        (() => {
          const m = item.takenAt.match(/[T ](\d{2}):(\d{2})/);
          if (!m) return null;
          const h24 = parseInt(m[1], 10);
          return `${h24 % 12 || 12}:${m[2]}${h24 >= 12 ? "pm" : "am"}`;
        })(),
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const starred = favourites?.has(item.remoteId) ?? false;
  const sub = line ?? [when, item.origin].filter(Boolean).join(", ");
  /* a paper's page is a PDF: no picture to put in the strip */
  const pdfOf = (it: JobMediaItem) =>
    (it.fileType ?? "").toLowerCase().endsWith("pdf");

  return (
    <>
      <div className="wb2-mvscrim" onClick={onClose} />
      <div
        ref={dialog}
        className="wb2-mv"
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        tabIndex={-1}
      >
        <div className="wb2-mvtop">
          <div className="wb2-mvwho">
            <h2 className="wb2-mvname">
              <Fade>{item.name}</Fade>
            </h2>
            {(sub || item.fromClaim) && (
              <p className="wb2-mvline">
                {[
                  sub,
                  item.fromClaim && !item.name.includes(`#${item.fromClaim}`)
                    ? `on invoice #${item.fromClaim}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {err && <p className="wb2-mverr">{err}</p>}
          </div>
          {items.length > 1 && (
            <span className="wb2-mvcount">{`${index + 1} of ${items.length}`}</span>
          )}
          {actions.map((act) => (
            <Button
              key={act.key}
              kind={act.danger ? "delete" : "second"}
              disabled={busy !== null}
              aria-busy={busy === act.key || undefined}
              onClick={() => (act.confirm ? setAsking(act) : void run(act))}
            >
              {busy === act.key && act.busyLabel ? act.busyLabel : act.label}
            </Button>
          ))}
          {/* THE STAR IS WHERE THE PHOTO IS BIG. Curating from a 66px tile is
              guessing; this is the size at which somebody can actually decide
              a photo is worth showing another client. A word, as every
              button but the cross has (rule 27). */}
          {onStar && (
            <Button
              kind="second"
              icon="star"
              className={starred ? "wb2-mvstar on" : "wb2-mvstar"}
              aria-pressed={starred}
              onClick={() => onStar(item.remoteId)}
            >
              {starred ? "Starred" : "Star"}
            </Button>
          )}
          <IconButton glyph="close" label="Close viewer" onClick={onClose} />
        </div>
        <div className="wb2-mvbody">
          <div
            className={`wb2-mvpane${zoom !== null ? " zoomed" : ""}`}
            ref={stageRef}
            onDoubleClick={onDoubleClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {item.url === null ? (
              <p className="wb2-mvpending">
                This file hasn&apos;t been brought across yet.
              </p>
            ) : isPdf ? (
              <iframe
                className="wb2-mvframe"
                src={item.url}
                title={item.name}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={item.url}
                alt={item.name}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNatural({
                    index,
                    w: img.naturalWidth || 1,
                    h: img.naturalHeight || 1,
                  });
                }}
                style={
                  zoom !== null && nat
                    ? {
                        width: nat.w * zoom,
                        maxWidth: "none",
                        maxHeight: "none",
                      }
                    : undefined
                }
              />
            )}
          </div>
          {/* PREVIOUS AND NEXT, IN WORDS (the mock, frame 14): a bare ‹ › is
            only a date's (rule 27). They sit on the stage's edges, outside
            its scroller, so a zoomed photo never carries them off. */}
          {index > 0 && (
            <Button className="wb2-mvnav prev" onClick={() => onNav(index - 1)}>
              Previous
            </Button>
          )}
          {index < items.length - 1 && (
            <Button className="wb2-mvnav next" onClick={() => onNav(index + 1)}>
              Next
            </Button>
          )}
        </div>
        {/* THE REST OF THE ROLL, ALWAYS IN SIGHT. Previous and Next say a
            neighbour exists; they never say what it is, or how far the day
            runs. The strip is the mosaic's own order, so the photo you saw
            in the grid is the thumbnail you reach for.

            Thumbnails carry alt="" — they are the SAME photos already named
            on the stage and in the mosaic, so a name here would be a third
            reading of one thing. The button's aria-label does the talking. */}
        {items.length > 1 && (
          <div
            className="wb2-mvstrip"
            role="tablist"
            aria-label="Photos on this job"
          >
            {items.map((it, i) => (
              <button
                key={it.remoteId}
                ref={i === index ? currentThumbRef : undefined}
                className={`wb2-mvthumb${i === index ? " on" : ""}`}
                role="tab"
                aria-selected={i === index}
                aria-label={it.name}
                onClick={() => onNav(i)}
              >
                {it.url && !pdfOf(it) ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={it.url} alt="" loading="lazy" draggable={false} />
                ) : (
                  <Icon name={pdfOf(it) ? "file" : "cam"} size={13} />
                )}
                {/* aria-hidden: the button's own label already carries the
                    name, and the star's state is on the control in the head.
                    A pip that announced itself would be a third reading. */}
                {favourites?.has(it.remoteId) && (
                  <u className="wb2-mvthumbstar" aria-hidden>
                    <Icon name="star" size={10} />
                  </u>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* WHAT ENDS SOMETHING ASKS FIRST (rule 25), over the viewer: the red
          block names what the second press does, and Keep takes focus. */}
      {asking?.confirm && (
        <ConfirmDialog
          heading={asking.confirm.heading}
          confirm={asking.confirm.confirm}
          cancel={asking.confirm.cancel}
          busy={busy !== null}
          onConfirm={() => void run(asking)}
          onClose={() => setAsking(null)}
        >
          {asking.confirm.body}
        </ConfirmDialog>
      )}
    </>
  );
}
