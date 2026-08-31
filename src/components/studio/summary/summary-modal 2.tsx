"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";

/* The Summary step's dialog shell — Share and Export both wear it.

   Both were cards that unfolded into the chrome bar at the TOP of the sheet,
   and the sheet is a document several screens long. Press Share having read
   to the bottom and nothing moved: the card you asked for opened a screen and
   a half behind you. A dialog comes to the reader instead.

   Portalled to <body> for the usual reason — the shell's `.page` transform
   traps `position: fixed`, so a modal rendered in place is a modal stuck
   inside the scroller. The print stylesheet hides every body child that is
   not `#ds-printdoc`, so the scrim never reaches paper.

   Shared rather than grown twice: the second one of these would have been a
   copy of the first's scrim, header, Escape key and footer rule, and the
   Workboard already learned that lesson (see wb-modal.tsx). */

export function SummaryModal({
  title,
  icon,
  onClose,
  foot,
  children,
}: {
  title: string;
  icon: string;
  /** the scrim, the x and Escape all land here */
  onClose: () => void;
  /** the actions, on the bar under the body. Omitted = no bar. */
  foot?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const id = `ds-xm-title-${title.toLowerCase()}`;

  return createPortal(
    /* The ramp starts again here. `--ink`, the greys and the typeface are
       declared on `.fg`, which this is no longer inside; `--ds-*` and every
       `.dstudio .ds-…` rule the contents are built from need the class
       itself, and it goes on the DIALOG rather than the scrim because
       `.dstudio` is a padded flex column that would fight the centring. */
    <div
      className="ds-xm-ov"
      /* mousedown, not click: a drag that begins on a control inside the
         dialog and finishes over the backdrop must not dismiss it */
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="ds-xm dstudio"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header className="ds-xm-head">
          <span className="ds-xm-t" id={id}>
            <Icon name={icon} size={15} />
            {title}
          </span>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-xm-body">{children}</div>

        {foot && <footer className="ds-xm-foot">{foot}</footer>}
      </div>
    </div>,
    document.body
  );
}
