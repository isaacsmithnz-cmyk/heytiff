"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { Dot } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { PlanPick } from "@/lib/jobs/plans";
import type { JobMediaItem } from "@/lib/workboard/job-media";

/* ADD PLANS (the mock of 9 November 2026, board 4): the job's own files
   with a tick each, the ones a plan can be read from (a PDF, a picture),
   and under them a place to drop a set that isn't on the job yet. One
   press, Add N plans, and each ticked file is pressed into Plans and read
   once. A dropped file goes onto the job's Documents first, as Upload a
   file puts it, then into Plans with the rest. */

const ACCEPT = "application/pdf,image/png,image/jpeg";
const READABLE = /\.(pdf|png|jpe?g)$/i;

/** The job's files a plan can be read from: with bytes here, a PDF or a picture. */
export const planCandidates = (files: readonly JobMediaItem[]): JobMediaItem[] =>
  files.filter((f) => !!f.url && (f.fileType ? READABLE.test(f.fileType) : READABLE.test(f.name)));

/** What a file row says under its name: where it came from and when. */
function fileLine(item: JobMediaItem): string {
  const day = item.takenAt ? fmtAuWeekdayDayMonth(item.takenAt.slice(0, 10)) : null;
  const who = item.documentId ? (item.addedBy ? `Added by ${item.addedBy}` : "Added in HeyTiff") : item.origin === "Emailed in" ? "From the client" : "Added in ServiceM8";
  return [who, day].filter(Boolean).join(", ");
}

export type UploadForPlans = (file: File) => Promise<{ ok: true; documentId: string } | { ok: false; error: string }>;

export function AddPlansDialog({
  files,
  onAdd,
  onUpload,
  onClose,
}: {
  /** the job's files not yet in Plans */
  files: readonly JobMediaItem[];
  /** press the picks into Plans; null once they're in, or the reason not */
  onAdd: (picks: PlanPick[]) => Promise<string | null>;
  /** a dropped file onto the job first; absent while the job isn't known */
  onUpload?: UploadForPlans;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [dropped, setDropped] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const candidates = planCandidates(files);
  const count = picked.size + dropped.length;
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const takeFiles = (list: File[]) => {
    const good = list.filter((f) => READABLE.test(f.name) || f.type === "application/pdf" || f.type.startsWith("image/"));
    if (good.length < list.length) setError("Only a PDF, PNG or JPG can be read as a plan.");
    if (good.length) setDropped((d) => [...d, ...good]);
  };

  const add = async () => {
    if (!count || busy) return;
    setError(null);
    const picks: PlanPick[] = candidates.filter((f) => picked.has(f.remoteId)).map((f) => (f.documentId ? { documentId: f.documentId } : { attachmentId: f.remoteId }));
    if (dropped.length && onUpload) {
      for (let i = 0; i < dropped.length; i++) {
        setBusy(dropped.length === 1 ? "Uploading the file" : `Uploading ${i + 1} of ${dropped.length}`);
        const up = await onUpload(dropped[i]);
        if (!up.ok) {
          setBusy(null);
          setError(`${dropped[i].name}: ${up.error}`);
          return;
        }
        picks.push({ documentId: up.documentId });
      }
    }
    setBusy("Adding to Plans");
    const why = await onAdd(picks).catch(() => "The plans couldn't be added. Try again.");
    setBusy(null);
    if (why) setError(why);
    else onClose();
  };

  return (
    <Dialog
      heading="Add plans"
      onClose={onClose}
      width={560}
      dismissable={!busy}
      foot={
        <>
          {busy && (
            <span className="jpl-busy" role="status">
              {busy}
            </span>
          )}
          <Button onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button kind="main" disabled={!count || !!busy} onClick={() => void add()}>
            {count === 0 ? "Add plans" : count === 1 ? "Add 1 plan" : `Add ${count} plans`}
          </Button>
        </>
      }
    >
      <div className="jpl-add">
        {candidates.length > 0 && (
          <RowList label="The job's files">
            {candidates.map((f) => (
              <Row
                key={f.remoteId}
                lead={<Tick className="jdoc-tick" checked={picked.has(f.remoteId)} onChange={(on) => toggle(f.remoteId, on)} label={<span className="sr-only">{`Add ${f.name}`}</span>} />}
                name={f.name}
                line={fileLine(f)}
                onClick={() => toggle(f.remoteId, !picked.has(f.remoteId))}
              />
            ))}
          </RowList>
        )}
        {dropped.length > 0 && (
          <RowList label="Files to add">
            {dropped.map((f, i) => (
              <Row
                key={`${f.name}-${i}`}
                lead={<Tick className="jdoc-tick" checked onChange={() => setDropped((d) => d.filter((_, k) => k !== i))} label={<span className="sr-only">{`Add ${f.name}`}</span>} />}
                name={f.name}
                line="Dropped here, to the job's Documents and its Plans"
              />
            ))}
          </RowList>
        )}
        {onUpload && (
          <div
            className={`ds2-nd-drop${over ? " ds2-nd-drop--over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              takeFiles([...e.dataTransfer.files]);
            }}
          >
            <span className="ds2-nd-drop-ic" aria-hidden="true">
              <Icon name="upload" size={20} />
            </span>
            <span className="ds2-nd-drop-t">{candidates.length ? "Drop other plans" : "Drop the plans"}</span>
            <span className="ds2-nd-drop-s">A PDF of the set, or photos of the pages</span>
            <Button onClick={() => picker.current?.click()}>Choose files</Button>
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept={ACCEPT}
              aria-label="Choose plans to add"
              onChange={(e) => {
                takeFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>
        )}
        {candidates.length === 0 && !onUpload && <p className="jpl-none">No file on this job can be read as a plan yet.</p>}
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
