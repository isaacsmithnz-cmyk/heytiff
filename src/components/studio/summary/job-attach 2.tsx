"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import { prefillFromJob, type StudioJobHit } from "@/lib/studio/job-link";
import { JobSearchField } from "../job-search";

/* The lazy import lives OUT HERE, not in the component. The deferral is
   unchanged — the module is still fetched on the first call — but React
   Compiler 1.0 cannot lower an `import()` expression inside a component
   and gives up on the WHOLE component when it meets one. */
const studioActions = () => import("@/app/actions/studio");

/* Attaching an existing design to a ServiceM8 job.

   `jobLink` used to be written in exactly one place — `createDesign`, from
   the new-design step's job picker — so a design not born from a job could
   never be connected to one afterwards. That made the Material picklist
   push unreachable for those designs, because the push is gated on the link
   (deliberately: a button with nowhere to go is worse than no button).

   No new server action and no migration: this writes the same `jobLink`
   shape `createDesign` does, the studio's autosave persists the document,
   and `sm8JobUuid()` derives `studio_designs.sm8_job_uuid` from it on save —
   which is what the job card's "Designed in the studio" panel reads back.

   THE THREE META FIELDS ARE FILLED ONLY WHEN EMPTY. Picking a job on a NEW
   design writes its client and site outright, because there is nothing to
   lose. Here there may be — somebody has typed an addressee onto the sheet,
   and a job is not licence to overwrite it. Blank fields are filled, filled
   ones are left alone.

   DETACHING KEEPS PUSHED ROWS. `job_picklist_items` rows are snapshots of a
   push that really happened, keyed by the job they went to. Deleting them
   because the design later moved would erase something the warehouse may
   already be working from; leaving them is the honest record. Re-linking to
   a different job is the same reasoning — the old job keeps what it was
   given, and the new one starts empty. */

export function JobAttach({
  doc,
  onMutate,
}: {
  doc: DesignDocument;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const [picking, setPicking] = useState(false);

  const search = useCallback(
    (q: string) =>
      studioActions().then((a) => a.searchStudioJobs(q)),
    []
  );

  const attach = (hit: StudioJobHit) => {
    const fill = prefillFromJob(hit);
    setPicking(false);
    onMutate((d) => ({
      ...d,
      jobLink: {
        provider: "servicem8",
        remoteId: fill.remoteId,
        jobNumber: fill.jobNumber || null,
        linkedAt: new Date().toISOString(),
      },
      meta: {
        ...d.meta,
        /* only what is missing — see the note above */
        jobNumber: d.meta.jobNumber || fill.jobNumber,
        client: d.meta.client || fill.client,
        site: d.meta.site || fill.site,
      },
    }));
  };

  const detach = () =>
    onMutate((d) => ({ ...d, jobLink: null }));

  if (doc.jobLink) {
    return (
      <span className="ds-letter-src">
        <Icon name="tag" size={11} />
        Added from ServiceM8
        {doc.jobLink.jobNumber ? ` ${doc.jobLink.jobNumber}` : ""}
        <button
          type="button"
          className="ds-letter-unlink"
          onClick={detach}
          title="This design stops being attached to that job. Anything already added to the job card stays there."
        >
          Unlink
        </button>
      </span>
    );
  }

  if (picking) {
    return (
      <span className="ds-letter-pick">
        <JobSearchField
          onPick={attach}
          search={search}
          autoFocus
          placeholder="Job number, client or address"
        />
        <button
          type="button"
          className="ds-letter-unlink"
          onClick={() => setPicking(false)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="ds-letter-attach"
      onClick={() => setPicking(true)}
    >
      <Icon name="tag" size={11} />
      Attach a ServiceM8 job
    </button>
  );
}
