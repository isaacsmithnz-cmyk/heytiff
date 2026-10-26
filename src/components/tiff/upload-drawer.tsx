"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { Dot, StateWord } from "@/components/parts/state";
import { KB_CATEGORIES } from "./kb";
import { TagField } from "./tag-picker";
import {
  checkKbUpload,
  fmtResets,
  isLargeKb,
  KB_LARGE_PER_MONTH,
  type KbCategory,
  type KbLargeAllowance,
} from "@/lib/tiff/files";
import { guessKbCategory, titleFromFilename } from "@/lib/tiff/guess";
import { guessKbTags, type KbTagRef } from "@/lib/tiff/tags";
import { uploadKbFile } from "@/lib/tiff/upload-client";
import type { KbIngestProgress } from "@/lib/tiff/use-kb-ingest";

/* Adding manuals — a dialog over the library, not a page away from it (the
   old-modals mock, 27 October 2026: the side sheet became the Dialog part,
   centred like every other form, rule 51).

   ONE FILE AT A TIME, START TO FINISH. Uploads are sequential rather than
   parallel because the reading that follows them is: the page allowance is
   checked per batch, and a browser firing five uploads at once only produces
   five documents queued behind each other anyway — with five progress bars
   pretending otherwise.

   CLOSING IS NOT CANCELLING. Everything handed over is already a row with a
   bookmark, and the library drives it whether this dialog is open or not.
   Close, the scrim and Escape are held only while bytes are actually moving,
   because THAT is the part a closed tab would lose. */

type Phase = "queued" | "uploading" | "handed" | "error";

type Pending = {
  key: string;
  file: File;
  title: string;
  category: KbCategory;
  source: string;
  tagIds: string[];
  /** Set when the file itself is refused — wrong type, too big, empty. */
  invalid: string | null;
  phase: Phase;
  documentId?: string;
  error?: string;
};

let seq = 0;

function toPending(file: File, tags: KbTagRef[], large: KbLargeAllowance): Pending {
  const check = checkKbUpload({ type: file.type, size: file.size }, large);
  return {
    key: `f${(seq += 1)}`,
    file,
    title: titleFromFilename(file.name),
    category: guessKbCategory(file.name),
    source: "",
    /* Same standing as the title and the category beside it: an offer read off
       the filename, ticked before anybody looks at it, and undone with a
       click. Nothing downstream trusts it — the server re-checks every id. */
    tagIds: guessKbTags(file.name, tags),
    invalid: check.ok ? null : check.error,
    phase: "queued",
  };
}

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function UploadDrawer({
  tags = [],
  large = null,
  progress,
  onIngest,
  onClose,
}: {
  /** The org's tags, for the per-file picker and the filename guess. */
  tags?: KbTagRef[];
  /** What this person may bring in over 50 MB this month (null: nothing). */
  large?: KbLargeAllowance;
  /** documentId → live ingest progress, from the library's queue. */
  progress: Record<string, KbIngestProgress>;
  onIngest: (documentIds: string[]) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Pending[]>([]);
  /* A tag created inside a file's picker has to be offered to the NEXT file
     too — the drawer owns the list from here, not the page that opened it. */
  const [known, setKnown] = useState<KbTagRef[]>(tags);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    /* each large file already in the list uses one of this month's turns,
       so a third dropped in with two waiting is refused here rather than by
       the server once the first two have gone up */
    let left = large ? large.left - items.filter((i) => !i.invalid && isLargeKb(i.file.size)).length : 0;
    const next = Array.from(files).map((f) => {
      const p = toPending(f, known, large ? { ...large, left } : null);
      if (!p.invalid && isLargeKb(f.size)) left -= 1;
      return p;
    });
    if (next.length > 0) setItems((list) => [...list, ...next]);
  };

  const patch = (key: string, change: Partial<Pending>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const ready = items.filter((i) => !i.invalid && i.phase === "queued");

  /* The upload loop reads the list it is halfway through, so it needs the
     current one rather than the one captured when it started — a title edited
     while an earlier file is still going up is the title that gets stored. */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const startUploads = async () => {
    if (running || ready.length === 0) return;
    setRunning(true);
    const queue = ready.map((i) => i.key);

    for (const key of queue) {
      // read from the list each time: the title or category may have been
      // edited while an earlier file was still going up
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item) continue;

      patch(key, { phase: "uploading", error: undefined });
      const res = await uploadKbFile(item.file, {
        title: item.title,
        category: item.category,
        source: item.source.trim() || undefined,
        tagIds: item.tagIds,
        large,
      });

      if (!res.ok) {
        patch(key, { phase: "error", error: res.error });
        continue;
      }
      patch(key, { phase: "handed", documentId: res.documentId });
      // joins the library's single ingest queue — reading starts while the
      // next file is still uploading, but only ever one batch at a time
      onIngest([res.documentId]);
    }

    setRunning(false);
    router.refresh();
  };

  const label =
    ready.length === 0
      ? "Upload documents"
      : `Upload ${ready.length} ${ready.length === 1 ? "document" : "documents"}`;

  /* Closing is held while bytes are moving: Close, the scrim and Escape all
     wait, because this component IS the upload. */
  const close = () => {
    if (!running) onClose();
  };

  return (
    <Dialog
      heading="Add documents"
      width={720}
      onClose={close}
      dismissable={!running}
      foot={
        <>
          {/* It used to say "Hide" while running, which promised a drawer you
              could come back to — but this component IS the upload, so
              closing it destroyed the progress and left a row nothing could
              see. It stays shut until the files have landed. */}
          <Button kind="quiet" disabled={running} onClick={close}>
            Close
          </Button>
          <Button kind="main" disabled={running || ready.length === 0} onClick={() => void startUploads()}>
            {label}
          </Button>
        </>
      }
    >
      <div className="tk-up">
        <p className="tk-upfact">
          PDFs up to 50 MB
          {large
            ? large.left > 0
              ? `; ${large.left} of ${KB_LARGE_PER_MONTH} large uploads, up to 150 MB, left this month.`
              : `. This month's ${KB_LARGE_PER_MONTH} large uploads (up to 150 MB) are used; more from ${fmtResets(large.resetsOn)}.`
            : "."}
        </p>

        <div
          className={`tk-drop${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer?.files ?? null);
          }}
        >
          <span className="tk-dropic" aria-hidden="true">
            <Icon name="upload" size={20} />
          </span>
          <b>Drop PDFs here</b>
          <Button onClick={() => picker.current?.click()}>Choose files</Button>
          <input
            ref={picker}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 && (
          <ul className="tk-files" aria-label="Documents to add">
            {items.map((item) => (
              <FileRow
                key={item.key}
                item={item}
                tags={known}
                progress={item.documentId ? progress[item.documentId] : undefined}
                onChange={(change) => patch(item.key, change)}
                onCreatedTag={(tag) =>
                  setKnown((list) => (list.some((t) => t.id === tag.id) ? list : [...list, tag]))
                }
                onRemove={() => setItems((list) => list.filter((i) => i.key !== item.key))}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function FileRow({
  item,
  tags,
  progress,
  onChange,
  onCreatedTag,
  onRemove,
}: {
  item: Pending;
  tags: KbTagRef[];
  progress?: KbIngestProgress;
  onChange: (change: Partial<Pending>) => void;
  onCreatedTag: (tag: KbTagRef) => void;
  onRemove: () => void;
}) {
  const hue = item.invalid ? "grey" : (KB_CATEGORIES.find((c) => c.key === item.category)?.hue ?? "grey");
  const editable = item.phase === "queued" && !item.invalid;

  return (
    <li className={`tk-file${editable ? " open" : ""}`}>
      <div className="tk-fhd">
        <Dot hue={hue} />
        <b className="tk-fname">
          <Fade>{item.file.name}</Fade>
        </b>
        {(editable || item.invalid) && <span className="tk-fsize">{fmtSize(item.file.size)}</span>}
        {editable ? (
          <Button kind="quiet" size={32} className="tk-frm" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
            Remove file
          </Button>
        ) : item.invalid ? (
          <>
            <StateWord tone="wrong">{item.invalid}</StateWord>
            <Button kind="quiet" size={32} className="tk-frm" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
              Remove file
            </Button>
          </>
        ) : (
          <FileProgress item={item} progress={progress} />
        )}
      </div>

      {editable && (
        <div className="tk-fform">
          <Field label="Title">
            <TextInput value={item.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Category">
            {/* Field notes are WRITTEN, never uploaded — they come from the
                note widget's review card. Offering the shelf here would
                invite a PDF into a category whose whole meaning is "a
                person said this on a job". */}
            <Chooser
              value={item.category}
              onChange={(v) => onChange({ category: v as KbCategory })}
              options={KB_CATEGORIES.filter((c) => c.key !== "field").map((c) => ({ value: c.key, label: c.label }))}
            />
          </Field>
          <Field label="Source">
            <TextInput placeholder="Brand or author" value={item.source} onChange={(e) => onChange({ source: e.target.value })} />
          </Field>
          {/* `onCreated` only has the dialog's shared list to update — the
              field ticks a tag it just made onto this file itself. */}
          <div className="tk-fspan">
            <TagField tags={tags} value={item.tagIds} onChange={(tagIds) => onChange({ tagIds })} onCreated={onCreatedTag} />
          </div>
        </div>
      )}
    </li>
  );
}

/* Where a file is up to, as a state word on its row (rule 17): grey while it
   goes up and is read, green once Tiff can quote it, orange when it waits on
   the month's pages, red when it failed. */
function FileProgress({ item, progress }: { item: Pending; progress?: KbIngestProgress }) {
  if (item.phase === "uploading") return <StateWord tone="info">Uploading the document</StateWord>;
  if (item.phase === "error") return <StateWord tone="wrong">{item.error ?? "That upload didn't finish."}</StateWord>;
  if (!progress) return <StateWord tone="info">Queued for reading</StateWord>;
  if (progress.status === "processing") {
    const known = progress.pageCount !== null && progress.pageCount > 0;
    return (
      <StateWord tone="info">
        {known
          ? `Reading ${progress.pagesDone.toLocaleString("en-AU")} of ${progress.pageCount!.toLocaleString("en-AU")} pages`
          : "Reading the document"}
      </StateWord>
    );
  }
  if (progress.status === "paused") return <StateWord tone="look">Out of pages this month, it resumes on its own</StateWord>;
  if (progress.status === "failed") return <StateWord tone="wrong">{progress.error ?? "That document couldn't be read."}</StateWord>;
  return <StateWord tone="good">Ready, Tiff can quote it</StateWord>;
}
