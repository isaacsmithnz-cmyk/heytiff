"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveCertWording } from "@/app/actions/certificates";
import { withCleanup } from "@/lib/ui/with-cleanup";

/** The owner's one press, as for the SWMS template. */
export function ApproveWording() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    await withCleanup(
      async () => {
        try {
          const res = await approveCertWording();
          if (res.ok) router.refresh();
          else setError(res.error);
        } catch {
          setError("Couldn't record the approval. Try again.");
        }
      },
      () => setBusy(false)
    );
  };

  return (
    <>
      {error && <span className="sw-state bad">{error}</span>}
      <button type="button" className="pbtn primary" disabled={busy} onClick={approve}>
        {busy ? "Approving…" : "Approve the wording"}
      </button>
    </>
  );
}
