"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "@/components/overlay/use-overlay";

/* THE DIALOG (rule 36). White, the card's 16 corner and the one shadow, on
   the scrim that darkens the page. Portalled to <body>, outside `.fg`, so it
   floats over the frame at --z-modal. The title is the type scale's dialog
   size; the foot holds its buttons on the right.

   The overlay stack (use-overlay) gives it Escape, Tab going round inside it
   and focus going back to what opened it, so it is mounted only while it is
   open. It takes focus itself on the way in: whatever inside it carries
   `data-autofocus`, else the dialog, which reads its title out.

   The title is `heading`, not `title`: a `title=` attribute is a tooltip,
   and the ratchets count every one written. */

export type DialogWidth = 400 | 560 | 720;

export type DialogProps = {
  /** Mounted while true. Leave it out to mount the dialog yourself. */
  open?: boolean;
  /** The title, 20/28/600, and the dialog's accessible name. */
  heading: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  /** The buttons, laid out on the right. */
  foot?: ReactNode;
  width?: DialogWidth;
  /** False: a click on the scrim leaves it open. Escape still closes it. */
  dismissable?: boolean;
  /** An id inside the body that says what the dialog is about. */
  describedBy?: string;
};

const noSubscribe = () => () => {};
/** False while rendering on the server and hydrating, so a portal never
    reaches for a `document` that is not there. */
const useClient = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export function Dialog({ open = true, ...props }: DialogProps) {
  const client = useClient();
  if (!open || !client) return null;
  return <DialogSurface {...props} />;
}

function DialogSurface({
  heading,
  onClose,
  children,
  foot,
  width = 400,
  dismissable = true,
  describedBy,
}: Omit<DialogProps, "open">) {
  const dialog = useRef<HTMLDivElement>(null);
  /* Where the press began. A drag that starts in the dialog and ends on the
     scrim (selecting text in a field) is not a click on the scrim. */
  const downOnScrim = useRef(false);
  const titleId = useId();
  useOverlay(dialog, { onEscape: onClose });

  useEffect(() => {
    const el = dialog.current;
    if (!el || el.contains(document.activeElement)) return;
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el).focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      className="pt-scrim"
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (dismissable && downOnScrim.current && e.target === e.currentTarget) onClose();
        downOnScrim.current = false;
      }}
    >
      <div
        ref={dialog}
        className={`pt-dialog pt-dialog--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <h2 id={titleId} className="pt-dialog-title">
          {heading}
        </h2>
        {children != null && <div className="pt-dialog-body">{children}</div>}
        {foot != null && <div className="pt-dialog-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ARE YOU SURE (rules 25 and 36). The one place a red block button stands:
   the dialog that asks before something is undone for good. Both buttons
   name what they do, "Delete visit" and "Keep it", and the one that keeps
   things takes focus, so Enter on arrival is never the loss. The buttons
   wear the Button part's classes; that part draws them. */

export type ConfirmDialogProps = {
  open?: boolean;
  heading: ReactNode;
  /** What it means for you, in a sentence or two. */
  children?: ReactNode;
  /** A verb and a noun: "Delete visit". */
  confirm: string;
  /** A verb and a noun: "Keep it". */
  cancel?: string;
  onConfirm: () => void;
  /** The cancel button, Escape and the scrim. */
  onClose: () => void;
  /** False for a sure-you-want-to that loses nothing: the main button, not red. */
  danger?: boolean;
  /** The confirm button is held while the work is out. */
  busy?: boolean;
};

export function ConfirmDialog({
  open = true,
  heading,
  children,
  confirm,
  cancel = "Keep it",
  onConfirm,
  onClose,
  danger = true,
  busy = false,
}: ConfirmDialogProps) {
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      heading={heading}
      onClose={onClose}
      describedBy={children != null ? bodyId : undefined}
      foot={
        <>
          <button type="button" className="pt-btn pt-btn--second" data-autofocus onClick={onClose}>
            {cancel}
          </button>
          <button
            type="button"
            className={`pt-btn ${danger ? "pt-btn--danger" : "pt-btn--main"}`}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {confirm}
          </button>
        </>
      }
    >
      {children != null && <div id={bodyId}>{children}</div>}
    </Dialog>
  );
}
