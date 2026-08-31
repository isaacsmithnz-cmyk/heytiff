"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { PicklistRow } from "@/lib/studio/summary";

/* The lazy import lives OUT HERE, not in the component. The deferral is
   unchanged — the module is still fetched on the first call — but React
   Compiler 1.0 cannot lower an `import()` expression inside a component
   and gives up on the WHOLE component when it meets one. */
const jobPicklistActions = () => import("@/app/actions/job-picklist");

/* Say what actually happened, in the order a person cares about. The two
   that need a person — a figure that changed under something already picked,
   and a line the design has dropped — are named plainly and carry the
   warning tone; "Already on the job" would have been a lie the moment either
   existed.

   Both of these live out here rather than in `push`'s try/catch: React
   Compiler 1.0 cannot lower a value block — a ternary, a `||` — inside a try
   and gives up on the whole component when it meets one. */
const pushOutcome = (r: {
  added: number;
  updated: number;
  heldBack: number;
  orphaned: number;
}): { kind: "warn" | "done"; msg: string } => {
  const parts = [
    r.added > 0 ? `${r.added} added` : null,
    r.updated > 0 ? `${r.updated} updated` : null,
    r.heldBack > 0
      ? `${r.heldBack} changed since ${r.heldBack === 1 ? "it was" : "they were"} picked`
      : null,
    r.orphaned > 0 ? `${r.orphaned} no longer in the design` : null,
  ].filter(Boolean);
  return {
    kind: r.heldBack > 0 || r.orphaned > 0 ? "warn" : "done",
    msg: parts.length > 0 ? parts.join(" · ") : "Already on the job",
  };
};

/* a server action with no catch returns a bare 503 the UI can neither
   explain nor stop retrying */
const pushFailure = (e: unknown) =>
  e instanceof Error ? e.message : "Could not add to the job";

/* "Add to job" — the Material picklist's one action, and the only thing on
   the sheet that leaves it.

   THE SHEET IS NOT THE LIST. Nothing here is tickable: the picklist becomes a
   checklist when it is pushed to the ServiceM8 job card, one item per line,
   ticked by whoever is standing in the warehouse. This button is the push.

   Was the header of a `PicklistCard` that also drew the rows. The rows moved
   into the shared document (sheet-doc.tsx), because the customer's copy and
   the printed one list the same materials; only the button is the owner's. */

export function PicklistPush({
  rows,
  jobLink,
  designId,
}: {
  rows: PicklistRow[];
  /** the linked ServiceM8 job, when there is one — the push has nowhere to go
      without it, so the button is absent rather than dead */
  jobLink: { remoteId: string; jobNumber: string | null } | null;
  designId: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; msg: string }
    /** pushed, but something needs a person — see the message */
    | { kind: "warn"; msg: string }
    | { kind: "err"; msg: string }
  >({ kind: "idle" });

  const push = async () => {
    if (!jobLink) return;
    setState({ kind: "busy" });
    try {
      const { pushPicklistToJob } = await jobPicklistActions();
      const r = await pushPicklistToJob(jobLink.remoteId, designId, rows);
      setState(pushOutcome(r));
    } catch (e) {
      setState({ kind: "err", msg: pushFailure(e) });
    }
  };

  if (!jobLink) return null;

  return (
    <div className="dsd-pick-act">
      {state.kind === "done" && <em className="ok">{state.msg}</em>}
      {state.kind === "warn" && <em className="warn">{state.msg}</em>}
      {state.kind === "err" && <em className="err">{state.msg}</em>}
      <button
        className="ds-chrome-btn cta"
        onClick={push}
        disabled={state.kind === "busy" || rows.length === 0}
      >
        <Icon name="check" size={13} />
        {state.kind === "busy"
          ? "Adding…"
          : /* after a push it is a RE-push: the same button, saying what
               pressing it would do now rather than what it did once */
            `${state.kind === "idle" ? "Add to" : "Update"} job${
              jobLink.jobNumber ? ` ${jobLink.jobNumber}` : ""
            }`}
      </button>
    </div>
  );
}
