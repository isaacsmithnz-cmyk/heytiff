"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import {
  candidateLabel,
  candidateRoleLabel,
  transferWarning,
  type OwnerCandidate,
} from "@/lib/org/ownership";
import type { TransferResult } from "./types";

/* Handing the account to someone else.

   PORTALLED TO <body>, like every dashboard modal — `.page.in` keeps
   `will-change`, which makes it a containing block for position:fixed, so a
   modal rendered inside the page anchors to the page and lands halfway down
   the scroll. The `.fg` wrapper is display:contents: no box, but the tokens
   and the field styles still reach the fields inside.

   TWO STEPS, DELIBERATELY. Choosing a person and agreeing to lose the account
   are different decisions, and a picker whose selection fires the write turns
   a misclick into the one act on this screen that cannot be undone alone — the
   new owner has to hand it back. So the list picks, and a second button on a
   panel that names what happens commits. It is the same shape as the
   credential modal's armed Delete, at the size this deserves.

   What it does NOT do is ask for a password or a typed confirmation. This
   screen is already behind the master-owner gate, and the act is reversible by
   the person receiving it — theatre would cost more than it buys. */
export function TransferOwnerModal({
  candidates,
  currentOwnerLabel,
  onTransfer,
  onClose,
}: {
  candidates: OwnerCandidate[];
  /** who holds it today, so the panel can say the whole sentence */
  currentOwnerLabel: string;
  onTransfer: (userId: string) => Promise<TransferResult>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<OwnerCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = async () => {
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const res = await onTransfer(picked.userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const warning = picked ? transferWarning(picked) : null;

  return createPortal(
    <div className="fg" style={{ display: "contents" }}>
      <div className="fl-ov" onClick={onClose}>
        <div
          className="fl-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Hand over the account"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fl-mh">
            <div>
              <b>Hand over the account</b>
              <em>{currentOwnerLabel} holds it now</em>
            </div>
            <button className="fl-x" type="button" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="fl-mb">
            {/* Nobody to hand it to is a STATE, not an error: a one-person
                business is the normal case, and it says what would change that
                rather than just refusing. */}
            {candidates.length === 0 ? (
              <div className="ro-empty">
                <span className="ei">
                  <Icon name="usershield" size={20} />
                </span>
                <b>There is nobody else signed in</b>
                <em>
                  The account can only be put in the name of someone who has accepted their
                  invite and signed in at least once.
                </em>
              </div>
            ) : (
              <>
                <div className="ownlist" role="radiogroup" aria-label="Who the account goes to">
                  {candidates.map((c) => {
                    const on = picked?.userId === c.userId;
                    return (
                      <button
                        key={c.userId}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={"ownrow" + (on ? " on" : "")}
                        onClick={() => {
                          setPicked(c);
                          setError(null);
                        }}
                      >
                        <span className="ownrow-k">
                          <b>{candidateLabel(c)}</b>
                          {c.email && <i>{c.email}</i>}
                        </span>
                        <span className="ownrow-r">{candidateRoleLabel(c)}</span>
                        {on && (
                          <span className="ownrow-t" aria-hidden="true">
                            <Icon name="check" size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* The consequences, and they only appear once there is a
                    person for them to be about — stated up front, above an
                    empty list, they would read as a warning about nothing. */}
                {picked && (
                  <div className="ownwarn">
                    <b>{candidateLabel(picked)} becomes the account owner.</b>
                    <span>
                      You stay an owner and keep every capability — what you lose is the
                      master’s protection: from then on another owner can change or remove
                      your access, and only {candidateLabel(picked)} can hand the account
                      back.
                    </span>
                    {warning && <span>{warning}</span>}
                  </div>
                )}
              </>
            )}

            {error && <div className="carderr">{error}</div>}

            <div className="fl-foot">
              <button className="fl-btn ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="fl-btn primary"
                type="button"
                disabled={busy || !picked}
                onClick={commit}
              >
                <Icon name="check" size={15} />
                {busy ? "Handing over…" : "Hand over the account"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
