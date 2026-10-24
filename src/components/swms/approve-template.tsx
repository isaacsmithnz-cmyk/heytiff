"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { approveSwmsLibrary } from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { withCleanup } from "@/lib/ui/with-cleanup";

/** The owner's one press. The bell item it clears goes at once. */
export function ApproveTemplate({ onApproved }: { onApproved?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    await withCleanup(async () => {
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
      }
    }, () => setBusy(false));
  };

  return (
    <>
      {error && <span className="sw-state bad">{error}</span>}
      <Button kind="main" disabled={busy} onClick={approve}>
        {busy ? "Approving the template" : "Approve the template"}
      </Button>
    </>
  );
}
