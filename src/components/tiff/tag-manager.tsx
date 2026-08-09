"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ColorSwatches } from "./tag-picker";
import { createKbTag, deleteKbTag, updateKbTag } from "@/app/actions/kb-tags";
import {
  KB_TAG_KIND_LABELS,
  KB_TAG_KINDS,
  kbTagColorFor,
  kbTagLabel,
  type KbTagKind,
  type KbTagRef,
} from "@/lib/tiff/tags";

/* Managing the tags themselves — rename, recolour, regroup, remove.

   A SHEET, NOT A PAGE, and the same sheet the uploads use: this is something
   you do in the middle of tidying a library, and a route away from the rows
   you were looking at would lose your place. Portalled to <body> for the
   reason every dashboard overlay is — `.page.in` sets will-change, which traps
   position:fixed inside the shell.

   REMOVING A TAG NAMES ITS COUNT FIRST. "Delete Daikin" means nothing; "Daikin
   is on 14 documents" is the fact somebody needs. The documents survive — only
   the label comes off — and the confirm says so, because "delete" beside a
   library reads like it might take the manuals with it. */

export function TagManager({
  tags,
  usage,
  onClose,
}: {
  tags: KbTagRef[];
  /** tagId → how many documents wear it. A missing key is zero. */
  usage: Record<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<KbTagRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const remove = (tag: KbTagRef) =>
    start(async () => {
      setError(null);
      const res = await deleteKbTag(tag.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    });

  const groups = KB_TAG_KINDS.map((kind) => ({
    kind,
    items: tags.filter((t) => t.kind === kind),
  }));

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="tk-scrim" onClick={onClose} />
      <aside className="tk-sheet" role="dialog" aria-modal="true" aria-label="Manage tags">
        <header className="tk-shtop">
          <div>
            <h2>Tags</h2>
            <p>What goes on the spine — the manufacturer, the system type, the topic.</p>
          </div>
          <button type="button" className="tk-shx" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className="tgm">
          {error && <p className="tgp-err">{error}</p>}

          <NewTag onDone={() => router.refresh()} />

          {tags.length === 0 ? (
            <p className="tgp-none">No tags yet.</p>
          ) : (
            groups.map((g) => (
              <div key={g.kind} className="tgm-grp">
                <em>
                  {KB_TAG_KIND_LABELS[g.kind]}
                  <span>{g.items.length}</span>
                </em>
                {g.items.length === 0 ? (
                  <p className="tgm-empty">Nothing in this group.</p>
                ) : (
                  g.items.map((t) =>
                    /* THE CONFIRM REPLACES THE ROW, and so does the editor.
                       An org has fifty tags; a panel pinned to the bottom of
                       the sheet would put the question about the first one
                       forty rows below the button that asked it, off the
                       screen the person is looking at. */
                    confirming?.id === t.id ? (
                      <div key={t.id} className="tgm-conf">
                        <b>Remove “{t.label}”?</b>
                        <span>
                          {(usage[t.id] ?? 0) === 0
                            ? "It isn't on anything."
                            : `It comes off ${used(usage[t.id] ?? 0)} — the documents stay, and Tiff still quotes them.`}
                        </span>
                        <div className="tgm-cbtn">
                          <button type="button" className="tk-btn ghost" onClick={() => setConfirming(null)}>
                            Keep it
                          </button>
                          <button
                            type="button"
                            className="tk-btn danger"
                            disabled={busy}
                            onClick={() => remove(t)}
                          >
                            Remove “{t.label}”
                          </button>
                        </div>
                      </div>
                    ) : editing === t.id ? (
                      <EditTag
                        key={t.id}
                        tag={t}
                        onClose={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <div key={t.id} className="tgm-row">
                        <span className="tgm-d" style={{ background: t.color }} />
                        <b>{t.label}</b>
                        <em>{used(usage[t.id] ?? 0)}</em>
                        <button
                          type="button"
                          className="tk-abtn ico"
                          aria-label={`Edit ${t.label}`}
                          onClick={() => setEditing(t.id)}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          type="button"
                          className="tk-abtn ico dan"
                          aria-label={`Remove ${t.label}`}
                          onClick={() => setConfirming(t)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    )
                  )
                )}
              </div>
            ))
          )}
        </div>

        <footer className="tk-shft">
          <button type="button" className="tk-btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </>,
    document.body
  );
}

const used = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

/* ── making one from here ────────────────────────────────────────────────── */

function NewTag({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<KbTagKind>("brand");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // until somebody picks one, the swatch shown is the one the server would
  // choose anyway — so the preview is honest rather than a placeholder grey
  const shown = color ?? kbTagColorFor(kbTagLabel(label) || "tag");

  const save = () =>
    start(async () => {
      setError(null);
      const res = await createKbTag({ label, kind, color: shown });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLabel("");
      setColor(null);
      onDone();
    });

  return (
    <div className="tgm-new">
      <div className="tgm-nrow">
        <span className="tgm-d" style={{ background: shown }} />
        <input
          className="tk-fi"
          value={label}
          aria-label="New tag name"
          placeholder="New tag — a brand, a system type, a topic"
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) save();
          }}
        />
        <button type="button" className="tk-btn primary" disabled={busy || !label.trim()} onClick={save}>
          <Icon name="plus" size={14} />
          Add
        </button>
      </div>
      <div className="tgm-nopt">
        {KB_TAG_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`tgp-t${kind === k ? " on" : ""}`}
            aria-pressed={kind === k}
            style={{ "--tgc": shown } as React.CSSProperties}
            onClick={() => setKind(k)}
          >
            {KB_TAG_KIND_LABELS[k]}
          </button>
        ))}
        <ColorSwatches value={shown} onChange={setColor} label="New tag colour" />
      </div>
      {error && <p className="tgp-err">{error}</p>}
    </div>
  );
}

/* ── renaming, recolouring, regrouping ───────────────────────────────────── */

function EditTag({
  tag,
  onClose,
  onSaved,
}: {
  tag: KbTagRef;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(tag.label);
  const [color, setColor] = useState(tag.color);
  const [kind, setKind] = useState<KbTagKind>(tag.kind);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateKbTag(tag.id, { label, color, kind });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });

  return (
    <div className="tgm-edit">
      <div className="tgm-nrow">
        <span className="tgm-d" style={{ background: color }} />
        <input
          className="tk-fi"
          value={label}
          aria-label={`Rename ${tag.label}`}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="tgm-nopt">
        {KB_TAG_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`tgp-t${kind === k ? " on" : ""}`}
            aria-pressed={kind === k}
            style={{ "--tgc": color } as React.CSSProperties}
            onClick={() => setKind(k)}
          >
            {KB_TAG_KIND_LABELS[k]}
          </button>
        ))}
        <ColorSwatches value={color} onChange={setColor} label={`Colour for ${tag.label}`} />
      </div>
      {error && <p className="tgp-err">{error}</p>}
      <div className="tgm-cbtn">
        <button type="button" className="tk-btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="tk-btn primary" disabled={busy || !label.trim()} onClick={save}>
          <Icon name="save" size={14} />
          Save
        </button>
      </div>
    </div>
  );
}
