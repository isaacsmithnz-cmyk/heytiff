"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/** A guided-step popup (DUCTR showCalibratePrompt / showNorthPrompt): a
    centred modal that introduces a canvas step — a lead line, then bullets,
    with a Skip and an action. */
export function StepPrompt({
  icon,
  title,
  intro,
  bullets,
  skipLabel = "Skip for now",
  actionLabel,
  onSkip,
  onAction,
}: {
  icon: string;
  title: string;
  intro: string;
  bullets: ReactNode[];
  skipLabel?: string;
  actionLabel: string;
  onSkip: () => void;
  onAction: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="ds-prompt-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onSkip()}
    >
      <div className="ds-prompt" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ds-prompt-head">
          <span className="ds-prompt-ic">
            <Icon name={icon} size={20} />
          </span>
          <h3>{title}</h3>
        </div>
        <p className="ds-prompt-intro">{intro}</p>
        <ul className="ds-prompt-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        <div className="ds-prompt-actions">
          <button className="ds-prompt-skip" onClick={onSkip}>
            {skipLabel}
          </button>
          <button className="ds-prompt-go" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
