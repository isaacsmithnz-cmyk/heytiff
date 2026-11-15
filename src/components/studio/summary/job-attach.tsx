"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Tooltip } from "@/components/parts/tooltip";
import { Button, IconButton } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field } from "@/components/parts/field";
import { Dot } from "@/components/parts/state";
import type { DesignDocument } from "@/lib/studio/document";
import { prefillFromJob, type StudioJobHit } from "@/lib/studio/job-link";
import type { PlanImages } from "@/lib/studio/plans";
import { designPageCaption, designPlanGroups, designPlanLine } from "@/lib/jobs/plans-from-design";
import { cardOfHit, JobCardFace, JobPicker, type JobLists } from "../job-picker";

/* The lazy imports live OUT HERE, not in the component. The deferral is
   unchanged — the module is still fetched on the first call — but React
   Compiler 1.0 cannot lower an `import()` expression inside a component
   and gives up on the WHOLE component when it meets one. */
const studioActions = () => import("@/app/actions/studio");
const linkPlans = (jobUuid: string, designId: string) =>
  import("@/app/actions/job-plans")
    .then((a) => a.linkPlansToJob(jobUuid, designId))
    .catch(() => ({ ok: false as const, error: "The plans couldn't be moved. Nothing was linked." }));
const readLater = (ids: string[]) => import("@/lib/jobs/plans-client").then((c) => c.kickPlanReads(ids)).catch(() => {});

const JOB_LISTS: JobLists = {
  recent: (ids) => studioActions().then((a) => a.readStudioJobs(ids)),
  list: (from, limit) => studioActions().then((a) => a.listStudioJobs(from, limit)),
};

/* Linking an existing design to a ServiceM8 job.

   `jobLink` used to be written in exactly one place — `createDesign`, from
   the new-design step's job picker — so a design not born from a job could
   never be connected to one afterwards. That made the Material picklist
   push unreachable for those designs, because the push is gated on the link
   (deliberately: a button with nowhere to go is worse than no button).

   LINKING MOVES ITS PLANS ONTO THE JOB (Isaac, 14 November 2026, the mock
   "Designs from a job", https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs:
   "Linking moves its plans onto the job"; "Link job" for Attach a
   ServiceM8 job). Link job opens a dialog: the job is picked as New design
   picks one, from job cards, then the plans going onto the job are listed
   with what Tiff read, and Link job puts each of the design's files onto the
   job's Documents and into its Plans with the design's own read, so it isn't
   read twice (lib/jobs/plans-link-server.ts). The design then says it came
   from the job's plan, and Edit plans opens the job's plans.

   The rest is as it was: this writes the same `jobLink` shape `createDesign`
   does, the studio's autosave persists the document, and `sm8JobUuid()`
   derives `studio_designs.sm8_job_uuid` from it on save — which is what the
   job card's "Designed in the studio" panel reads back.

   THE THREE META FIELDS ARE FILLED ONLY WHEN EMPTY. Picking a job on a NEW
   design writes its client and site outright, because there is nothing to
   lose. Here there may be — somebody has typed an addressee onto the sheet,
   and a job is not licence to overwrite it. Blank fields are filled, filled
   ones are left alone.

   DETACHING KEEPS PUSHED ROWS, AND THE PLANS. `job_picklist_items` rows are
   snapshots of a push that really happened, keyed by the job they went to.
   Deleting them because the design later moved would erase something the
   warehouse may already be working from; leaving them is the honest record.
   The plans moved onto the job stay there for the same reason. */

export function JobAttach({
  doc,
  onMutate,
  planImages,
}: {
  doc: DesignDocument;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** the plans' pictures, for the dialog's thumbnails */
  planImages?: PlanImages;
}) {
  const [open, setOpen] = useState(false);

  const detach = () => onMutate((d) => ({ ...d, jobLink: null }));

  if (doc.jobLink) {
    return (
      <span className="ds-letter-src">
        <Icon name="tag" size={11} />
        Added from ServiceM8
        {doc.jobLink.jobNumber ? ` ${doc.jobLink.jobNumber}` : ""}
        <Tooltip label="This design stops being linked to that job. Anything already added to the job card stays there, its plans too.">
          <button type="button" className="ds-letter-unlink" onClick={detach}>
            Unlink
          </button>
        </Tooltip>
      </span>
    );
  }

  return (
    <>
      <button type="button" className="ds-letter-attach" onClick={() => setOpen(true)}>
        <Icon name="tag" size={11} />
        Link job
      </button>
      {open && <LinkJobDialog doc={doc} onMutate={onMutate} planImages={planImages} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A page's small picture, from the design's own stored page. */
function PageThumb({ imageRef, alt, planImages }: { imageRef: string; alt: string; planImages?: PlanImages }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!planImages) return;
    let live = true;
    void planImages
      .url(imageRef)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [imageRef, planImages]);
  /* eslint-disable-next-line @next/next/no-img-element */
  return url ? <img src={url} alt={alt} /> : <span className="jpl-page-blank" aria-hidden="true" />;
}

function LinkJobDialog({
  doc,
  onMutate,
  planImages,
  onClose,
}: {
  doc: DesignDocument;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  planImages?: PlanImages;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<StudioJobHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => designPlanGroups(doc), [doc]);

  const search = useCallback((q: string) => studioActions().then((a) => a.searchStudioJobs(q)), []);

  const link = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const moved = groups.length > 0 ? await linkPlans(picked.remoteId, doc.id) : { ok: true as const, planIds: [], toRead: [], lead: null };
    if (!moved.ok) {
      setBusy(false);
      setError(moved.error);
      return;
    }
    if (moved.toRead.length) void readLater(moved.toRead);
    const fill = prefillFromJob(picked);
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
      /* the design now says which of the job's plans it came from */
      planImport: d.planImport && moved.lead ? { ...d.planImport, jobPlanId: moved.lead } : d.planImport,
    }));
    onClose();
  };

  const number = picked ? cardOfHit(picked).number : "";
  const foot = (
    <>
      <Button onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      {picked && (
        <Button kind="main" disabled={busy} onClick={() => void link()}>
          {busy ? (groups.length ? "Moving the plans" : "Linking") : "Link job"}
        </Button>
      )}
    </>
  );

  return (
    <Dialog heading={number ? `Link to job ${number}` : "Link job"} onClose={onClose} width={720} dismissable={!busy} foot={foot}>
      <div className="ds2-nd-form">
        <Field label="Job">
          {picked ? (
            <div className={`ds2-nd-picked sc-card sc-card--${cardOfHit(picked).hue}`}>
              <JobCardFace job={cardOfHit(picked)} plans={false} />
              <IconButton glyph="clear" label="Choose another job" size={32} disabled={busy} onClick={() => setPicked(null)} />
            </div>
          ) : (
            <JobPicker onPick={setPicked} search={search} lists={JOB_LISTS} />
          )}
        </Field>
        {picked && groups.length > 0 && (
          <Field label="Plans going onto the job">
            <div className="ds2-nd-plans">
              <ul className="pt-rows" aria-label="Plans going onto the job">
                {groups.map((g) => (
                  <li key={g.sourceRef} className="pt-row pt-row--wrap">
                    <span className="pt-row-text">
                      <span className="pt-row-name">{g.name}</span>
                      <span className="pt-row-line">{designPlanLine(doc, g)}</span>
                      <span className="jpl-pages jpl-pages--sm">
                        {g.pages.map((p) => (
                          <span key={p.sheet.id} className="jpl-page">
                            <PageThumb imageRef={p.sheet.imageRef} alt={designPageCaption(p)} planImages={planImages} />
                            <span>{designPageCaption(p)}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Field>
        )}
        {error && (
          <p className="ds2-nd-error" role="alert">
            <Dot hue="red" />
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
