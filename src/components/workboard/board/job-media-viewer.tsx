"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { readWheel } from "@/lib/studio/wheel";
import { clamp } from "@/lib/studio/geometry";
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

   Z-INDEX IS A WALKED FACT, NOT A TESTED ONE — jsdom cannot see a stacking
   context. The pair sits at 114/115: above the claim modal's 110/111,
   under the toasts at 130. */

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 12;

export function JobMediaViewer({
  items,
  index,
  favourites,
  onNav,
  onStar,
  onClose,
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
}) {
  const item = items[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const currentThumbRef = useRef<HTMLButtonElement>(null);
  /* Zoom and natural size are KEYED BY INDEX — navigating simply leaves the
     old entry behind, so there is no reset effect to cascade a render. null
     zoom = fit the stage by pure CSS. */
  const [zoomState, setZoomState] = useState<{ index: number; z: number } | null>(null);
  const [natural, setNatural] = useState<{ index: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoom = zoomState?.index === index ? zoomState.z : null;
  const nat = natural?.index === index ? natural : null;

  /* Arrow keys only — Escape belongs to the sheet's innermost-first chain. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < items.length - 1) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, items.length, onNav]);

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
    currentThumbRef.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [index]);

  const isPdf = ((item?.fileType ?? "").toLowerCase()).endsWith("pdf");

  /* A NATIVE wheel listener, passive:false — React 17+ binds onWheel
     passively at the root, so a JSX handler's preventDefault is silently
     dead and the page scrolls under the zoom (the canvas learned this
     first). Momentum events are non-cancelable; skip those. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isPdf) return;
    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      const g = readWheel(e, "zoom");
      if (g.kind !== "zoom") return;
      setZoomState((prev) => {
        const cur = prev?.index === index ? prev.z : null;
        /* THE FIT MUST MATCH THE CSS, or the first wheel notch jumps.
           The stage fits by object-fit:contain, which UPSCALES a small
           photo — so this is no longer clamped at 1:1. */
        const fit =
          nat === null
            ? 1
            : clamp(
                Math.min((stage.clientWidth - 16) / nat.w, (stage.clientHeight - 16) / nat.h),
                ZOOM_MIN,
                ZOOM_MAX
              );
        return { index, z: clamp((cur ?? fit) * g.factor, ZOOM_MIN, ZOOM_MAX) };
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [isPdf, index, nat]);

  if (!item) return null;

  const onDoubleClick = () => {
    if (isPdf) return;
    setZoomState(zoom === null ? { index, z: 1 } : null);
  };

  /* Drag pans a zoomed image — the stage is the scroller. */
  const onPointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || zoom === null) return;
    dragRef.current = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
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
        .join(" · ")
    : null;

  return (
    <>
      <div className="wb2-mvscrim" onClick={onClose} />
      <div className="wb2-mv" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="wb2-mvtop">
          <b>{item.name}</b>
          <em>{[when, item.origin].filter(Boolean).join(" · ")}</em>
          {item.fromClaim && <i className="wb2-chip">{`#${item.fromClaim}`}</i>}
          <span className="wb2-mvsp" />
          {/* THE STAR IS WHERE THE PHOTO IS BIG. Curating from a 66px tile is
              guessing; this is the size at which somebody can actually decide
              a photo is worth showing another client. */}
          {onStar && (
            <button
              className={`wb2-ico wb2-mvstar${favourites?.has(item.remoteId) ? " on" : ""}`}
              onClick={() => onStar(item.remoteId)}
              aria-pressed={favourites?.has(item.remoteId) ?? false}
              aria-label={
                favourites?.has(item.remoteId) ? `Unstar ${item.name}` : `Star ${item.name}`
              }
              title={
                favourites?.has(item.remoteId)
                  ? "Starred — in the showcase"
                  : "Star this photo for the showcase"
              }
            >
              <Icon name="star" size={14} />
            </button>
          )}
          {items.length > 1 && (
            <em className="wb2-mvcount">{`${index + 1} / ${items.length}`}</em>
          )}
          <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close viewer">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div
          className={`wb2-mvstage${zoom !== null ? " zoomed" : ""}`}
          ref={stageRef}
          onDoubleClick={onDoubleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {item.url === null ? (
            <p className="wb2-mvpending">
              This file hasn&apos;t been brought across yet — it&apos;s on its way.
            </p>
          ) : isPdf ? (
            <iframe className="wb2-mvframe" src={item.url} title={item.name} />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.url}
              alt={item.name}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ index, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
              }}
              style={
                zoom !== null && nat
                  ? { width: nat.w * zoom, maxWidth: "none", maxHeight: "none" }
                  : undefined
              }
            />
          )}
          {index > 0 && (
            <button
              className="wb2-mvnav prev"
              onClick={() => onNav(index - 1)}
              aria-label="Previous"
            >
              ‹
            </button>
          )}
          {index < items.length - 1 && (
            <button className="wb2-mvnav next" onClick={() => onNav(index + 1)} aria-label="Next">
              ›
            </button>
          )}
        </div>
        {/* THE REST OF THE ROLL, ALWAYS IN SIGHT. Two ‹ › arrows say a
            neighbour exists; they never say what it is, or how far the day
            runs. The strip is the mosaic's own order, so the photo you saw
            in the grid is the thumbnail you reach for.

            Thumbnails carry alt="" — they are the SAME photos already named
            on the stage and in the mosaic, so a name here would be a third
            reading of one thing. The button's aria-label does the talking. */}
        {items.length > 1 && (
          <div className="wb2-mvstrip" role="tablist" aria-label="Photos on this job">
            {items.map((it, i) => (
              <button
                key={it.remoteId}
                ref={i === index ? currentThumbRef : undefined}
                className={`wb2-mvthumb${i === index ? " on" : ""}`}
                role="tab"
                aria-selected={i === index}
                aria-label={it.name}
                title={it.name}
                onClick={() => onNav(i)}
              >
                {it.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={it.url} alt="" loading="lazy" draggable={false} />
                ) : (
                  <Icon name="cam" size={13} />
                )}
                {/* aria-hidden: the button's own label already carries the
                    name, and the star's state is on the control in the bar.
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
    </>
  );
}
