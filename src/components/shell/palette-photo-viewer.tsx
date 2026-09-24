"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { JobMediaViewer } from "@/components/workboard/board/job-media-viewer";
import { showcaseMediaItem } from "@/components/workboard/board/showcase-view";
import type { PhotoHit } from "@/app/actions/photo-search";

/* The photo a ⌘K hit opens — the Workboard's own viewer, over whatever screen
   the palette was opened on.

   ITS OWN MODULE so the palette can load it only when a photo is chosen: the
   palette rides every screen in the frame, and the viewer with its zoom and
   drag is weight nobody pays for until then.

   PORTALLED TO BODY, like every overlay here — the frame's stacking context
   would trap a fixed layer under the shell. Escape is taken in the capture
   phase and stopped there: the viewer leaves its Escape to whoever opened it,
   and nothing behind it should hear the key that closed it. */
export function PalettePhotoViewer({
  items,
  index,
  starred,
  onNav,
  onStar,
  onClose,
}: {
  /** A snapshot of the hits at the moment one was opened — typing on behind
      the viewer can never reshuffle the roll somebody is reading. */
  items: readonly PhotoHit[];
  index: number;
  starred: ReadonlySet<string>;
  onNav: (index: number) => void;
  onStar: (remoteId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <JobMediaViewer
      items={items.map(showcaseMediaItem)}
      index={index}
      favourites={starred}
      onNav={onNav}
      onStar={onStar}
      onClose={onClose}
    />,
    document.body
  );
}
