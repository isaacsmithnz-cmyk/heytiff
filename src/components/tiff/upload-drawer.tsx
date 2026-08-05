"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { KB_CATEGORIES } from "./kb";
import { checkKbUpload, type KbCategory } from "@/lib/tiff/files";
import { guessKbCategory, titleFromFilename } from "@/lib/tiff/guess";
import { uploadKbFile } from "@/lib/tiff/upload-client";
import type { KbIngestProgress } from "@/lib/tiff/use-kb-ingest";

/* Adding manuals — a drawer over the library, not a page away from it.

   PORTALLED TO <body>, like every overlay in the dashboard: `.page.in` sets
   will-change, which traps position:fixed inside the shell and would pin the
   sheet to the scrolled page instead of the viewport.

   ONE FILE AT A TIME, START TO FINISH. Uploads are sequential rather than
   parallel because the reading that follows them is: the page allowance is
   checked per batch, and a browser firing five uploads at once only produces
   five documents queued behind each other anyway — with five progress bars
   pretending otherwise.

   CLOSING IS NOT CANCELLING. Everything handed over is already a row with a
   bookmark, and the library drives it whether this drawer is open or not. The
   scrim is held shut only while bytes are actually moving, because THAT is the
   part a closed tab would lose. */

type Phase = "queued" | "uploading" | "handed" | "error";

type Pending = {
  key: string;
  file: File;
  title: string;
  category: KbCategory;
  source: string;
  /** Set when the file itself is refused — wrong type, too big, empty. */
  invalid: string | null;
  phase: Phase;
  documentId?: string;
  error?: string;
};

let seq = 0;

function toPending(file: File): Pending {
  const check = checkKbUpload({ type: file.type, size: file.size });
  return {
    key: `f${(seq += 1)}`,
    file,
    title: titleFromFilename(file.name),
    category: guessKbCategory(file.name),
    source: "",
    invalid: check.ok ? null : check.error,
    phase: "queued",
  };
}

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function UploadDrawer({
  progress,
  onIngest,
  onClose,
}: {
  /** documentId → live ingest progress, from the library's queue. */
  progress: Record<string, KbIngestProgress>;
  onIngest: (documentIds: string[]) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  /* The Escape listener is bound once; without a ref it would forever read the
     `running` of the render that bound it, which is always false. */
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // an upload in flight lives in THIS component; Escape would unmount it
      if (e.key === "Escape" && !runningRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const next = Array.from(files).map(toPending);
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

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className="tk-scrim"
        onClick={() => {
          if (!running) onClose();
        }}
      />
      <aside className="tk-sheet" role="dialog" aria-modal="true" aria-label="Add documents">
        <header className="tk-shtop">
          <div>
            <h2>Add documents</h2>
            <p>PDFs up to 50 MB. Tiff reads every page it can, then answers from them.</p>
          </div>
          <button
            type="button"
            className="tk-shx"
            aria-label="Close"
            disabled={running}
            title={running ? "Uploading — this closes when the files have landed" : undefined}
            onClick={() => {
              if (!running) onClose();
            }}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

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
          <Icon name="upload" size={26} />
          <b>Drop PDFs here</b>
          <span>or pick them from your computer</span>
          <button type="button" className="tk-btn ghost" onClick={() => picker.current?.click()}>
            Choose files
          </button>
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
          <div className="tk-files">
            {items.map((item) => (
              <FileRow
                key={item.key}
                item={item}
                progress={item.documentId ? progress[item.documentId] : undefined}
                onChange={(change) => patch(item.key, change)}
                onRemove={() => setItems((list) => list.filter((i) => i.key !== item.key))}
              />
            ))}
          </div>
        )}

        <footer className="tk-shft">
          {/* It used to say "Hide" while running, which promised a drawer you
              could come back to — but this component IS the upload, so closing
              it destroyed the progress and left a row nothing could see. It
              stays shut until the files have landed. */}
          <button type="button" className="tk-btn ghost" disabled={running} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="tk-btn primary"
            disabled={running || ready.length === 0}
            onClick={() => void startUploads()}
          >
            <Icon name="upload" size={15} />
            {label}
          </button>
        </footer>
      </aside>
    </>,
    document.body
  );
}

function FileRow({
  item,
  progress,
  onChange,
  onRemove,
}: {
  item: Pending;
  progress?: KbIngestProgress;
  onChange: (change: Partial<Pending>) => void;
  onRemove: () => void;
}) {
  const colour = KB_CATEGORIES.find((c) => c.key === item.category)?.color ?? "#9ca3af";
  const editable = item.phase === "queued" && !item.invalid;

  return (
    <div className={`tk-file${item.invalid ? " bad" : ""}`}>
      <div className="tk-fhd">
        <span className="tk-dot" style={{ background: colour }} />
        <b>{item.file.name}</b>
        <em>{fmtSize(item.file.size)}</em>
        {item.phase === "queued" && (
          <button type="button" className="tk-abtn ico" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {item.invalid ? (
        <p className="tk-frr">{item.invalid}</p>
      ) : editable ? (
        <div className="tk-fform">
          <label className="tk-ff span">
            <span>Title</span>
            <input
              className="tk-fi"
              value={item.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </label>
          <label className="tk-ff">
            <span>Category</span>
            <select
              className="tk-fi"
              value={item.category}
              onChange={(e) => onChange({ category: e.target.value as KbCategory })}
            >
              {KB_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tk-ff">
            <span>Source</span>
            <input
              className="tk-fi"
              placeholder="Brand or author (optional)"
              value={item.source}
              onChange={(e) => onChange({ source: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <FileProgress item={item} progress={progress} />
      )}
    </div>
  );
}

function FileProgress({ item, progress }: { item: Pending; progress?: KbIngestProgress }) {
  if (item.phase === "uploading") {
    return (
      <p className="tk-fst work">
        <span className="tk-spin" aria-hidden="true" />
        Uploading…
      </p>
    );
  }

  if (item.phase === "error") {
    return (
      <p className="tk-fst dan">
        <Icon name="alert" size={13} />
        {item.error ?? "That upload didn't finish."}
      </p>
    );
  }

  if (!progress) {
    return (
      <p className="tk-fst work">
        <span className="tk-spin" aria-hidden="true" />
        Queued for reading…
      </p>
    );
  }

  if (progress.status === "processing") {
    const known = progress.pageCount !== null && progress.pageCount > 0;
    return (
      <p className="tk-fst work">
        <span className="tk-spin" aria-hidden="true" />
        {known
          ? `Reading… ${progress.pagesDone.toLocaleString("en-AU")} of ${progress.pageCount!.toLocaleString("en-AU")} pages`
          : "Reading…"}
      </p>
    );
  }

  if (progress.status === "paused") {
    return (
      <p className="tk-fst warn">
        <Icon name="clock" size={13} />
        Out of pages this month — it resumes on its own
      </p>
    );
  }

  if (progress.status === "failed") {
    return (
      <p className="tk-fst dan">
        <Icon name="alert" size={13} />
        {progress.error ?? "That document couldn't be read."}
      </p>
    );
  }

  return (
    <p className="tk-fst ok">
      <Icon name="check" size={13} />
      Ready — Tiff can quote it
    </p>
  );
}
