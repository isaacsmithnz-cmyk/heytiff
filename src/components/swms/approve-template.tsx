"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveSwmsLibrary } from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";

/** The owner's one press. The bell item it clears goes at once. */
export function ApproveTemplate({ onApproved }: { onApproved?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await approveSwmsLibrary();
      if (res.ok) {
        window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
        if (onApproved) onApproved();
        else router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Couldn't record the approval. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <span className="sw-state bad">{error}</span>}
      <button type="button" className="pbtn primary" disabled={busy} onClick={approve}>
        {busy ? "Approving…" : "Approve the template"}
      </button>
    </>
  );
}
