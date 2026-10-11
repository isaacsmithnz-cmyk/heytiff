"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "@/components/overlay/use-overlay";
import { Icon } from "@/components/shell/icon";

/* The Workboard's modal shell — the fleet modal's skeleton, shared instead of
   re-grown: portal to <body> (.page.in's will-change traps position:fixed,
   and .fl-ov/.fl-modal are unscoped in shell.css for exactly this), Escape
   closes it and only it (the overlay stack), Tab stays inside, clicks inside
   don't fall through. */

export function WbModal({
  title,
  sub,
  wide,
  onClose,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useOverlay(dialog, { onEscape: onClose });

  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        ref={dialog}
        className={`fl-modal${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-mh">
          <span>
            <b>{title}</b>
            {sub && <em>{sub}</em>}
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">{children}</div>
      </div>
    </div>,
    document.body
  );
}
