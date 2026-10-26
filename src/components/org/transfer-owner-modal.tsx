"use client";

import { useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { Initials } from "@/components/parts/initials";
import {
  candidateLabel,
  candidateRoleLabel,
  transferWarning,
  type OwnerCandidate,
} from "@/lib/org/ownership";
import type { TransferResult } from "./types";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* Handing the account to someone else, on the Dialog part (old-modals mock,
   27 October 2026).

   TWO STEPS, DELIBERATELY. Choosing a person and agreeing to lose the account
   are different decisions, and a picker whose selection fires the write turns
   a misclick into the one act on this screen that cannot be undone alone — the
   new owner has to hand it back. So the list picks, and the blue button,
   under a sentence that names what happens, commits.

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
  /** who holds it today, said as the body's first sentence */
  currentOwnerLabel: string;
  onTransfer: (userId: string) => Promise<TransferResult>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<OwnerCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    if (!picked) return;
    setError(null);
    setBusy(true);
    await withCleanup(async () => {
      const res = await onTransfer(picked.userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    }, () => setBusy(false));
  };

  const warning = picked ? transferWarning(picked) : null;

  return (
    <Dialog
      heading="Hand over the account"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={busy || !picked} onClick={() => void commit()}>
            {busy ? "Handing over the account" : "Hand over the account"}
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <p className="mk-records-lead">{`${currentOwnerLabel} holds it now.`}</p>
        {/* Nobody to hand it to is a STATE, not an error: a one-person
            business is the normal case, and it says what would change that
            rather than just refusing. */}
        {candidates.length === 0 ? (
          <Empty
            what="There is nobody else signed in"
            line="The account can only be put in the name of someone who has accepted their invite and signed in at least once."
            action={null}
          />
        ) : (
          <>
            <div className="rcw-pick" role="radiogroup" aria-label="Who the account goes to">
              {candidates.map((c) => {
                const on = picked?.userId === c.userId;
                const name = candidateLabel(c);
                return (
                  <button
                    key={c.userId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="rcw-pickrow"
                    onClick={() => {
                      setPicked(c);
                      setError(null);
                    }}
                  >
                    <span className="rcw-radio" aria-hidden="true" />
                    <Initials name={name} beside />
                    <span className="rcw-pickrow-k">
                      <b>{name}</b>
                      {c.email && <span>{c.email}</span>}
                    </span>
                    <span className="rcw-pickrow-r">{candidateRoleLabel(c)}</span>
                  </button>
                );
              })}
            </div>

            {/* The consequences, and they only appear once there is a person
                for them to be about — stated up front, above an empty list,
                they would read as a warning about nothing. */}
            {picked && (
              <div className="rcw-says">
                <p>
                  <b>{`${candidateLabel(picked)} becomes the account owner.`}</b>{" "}
                  {`You stay an owner and keep every capability. What you lose is the master’s protection: from then on another owner can change or remove your access, and only ${candidateLabel(picked)} can hand the account back.`}
                </p>
                {warning && <p>{warning}</p>}
              </div>
            )}
          </>
        )}

        {error && <p className="mk-error">{error}</p>}
      </div>
    </Dialog>
  );
}
