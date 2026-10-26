"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Dot } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { ColourDiscs } from "./tag-picker";
import { createKbTag, deleteKbTag, updateKbTag } from "@/app/actions/kb-tags";
import {
  KB_TAG_KIND_LABELS,
  KB_TAG_KINDS,
  kbTagColorFor,
  kbTagHue,
  kbTagLabel,
  type KbTagKind,
  type KbTagRef,
} from "@/lib/tiff/tags";

/* Managing the tags themselves — rename, recolour, regroup, remove.

   A DIALOG OVER THE LIBRARY, NOT A PAGE (the old-modals mock, 27 October
   2026, where the side sheet became a centred dialog like every other form,
   rule 51): this is something you do in the middle of tidying a library,
   and a route away from the rows you were looking at would lose your place.

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

  return (
    <Dialog
      heading="Tags"
      width={560}
      onClose={onClose}
      foot={
        <Button kind="main" onClick={onClose}>
          Close tags
        </Button>
      }
    >
      <div className="tgm">
        {error && <p className="tgm-err">{error}</p>}

        <NewTag onDone={() => router.refresh()} />

        {tags.length === 0 ? (
          <p className="tgm-none">No tags yet.</p>
        ) : (
          groups.map((g) => (
            <section key={g.kind} className="tgm-grp" aria-label={KB_TAG_KIND_LABELS[g.kind]}>
              <h3 className="tgm-gh">{KB_TAG_KIND_LABELS[g.kind]}</h3>
              {g.items.length === 0 ? (
                <p className="tgm-none">Nothing in this group.</p>
              ) : (
                <ul className="tgm-rows">
                  {g.items.map((t) =>
                    /* THE CONFIRM REPLACES THE ROW, and so does the editor.
                       An org has fifty tags; a question pinned to the foot
                       would sit forty rows below the button that asked it. */
                    confirming?.id === t.id ? (
                      <li key={t.id} className="tgm-row tgm-conf">
                        <span className="tgm-ct">
                          <b>Remove “{t.label}”?</b>
                          <span>
                            {(usage[t.id] ?? 0) === 0
                              ? "It isn't on anything."
                              : `It comes off ${used(usage[t.id] ?? 0)}. The documents stay, and Tiff still quotes them.`}
                          </span>
                        </span>
                        <span className="tgm-cbtn">
                          <Button size={32} onClick={() => setConfirming(null)}>
                            Keep it
                          </Button>
                          <Button kind="danger" size={32} disabled={busy} onClick={() => remove(t)}>
                            {`Remove “${t.label}”`}
                          </Button>
                        </span>
                      </li>
                    ) : editing === t.id ? (
                      <li key={t.id} className="tgm-row tgm-editrow">
                        <EditTag
                          tag={t}
                          onClose={() => setEditing(null)}
                          onSaved={() => {
                            setEditing(null);
                            router.refresh();
                          }}
                        />
                      </li>
                    ) : (
                      <li key={t.id} className="tgm-row">
                        <Dot hue={kbTagHue(t.color)} />
                        <b className="tgm-name">{t.label}</b>
                        <span className="tgm-used">{used(usage[t.id] ?? 0)}</span>
                        <Button kind="quiet" size={32} aria-label={`Edit ${t.label}`} onClick={() => setEditing(t.id)}>
                          Edit
                        </Button>
                        <Button kind="quiet" size={32} className="tgm-rm" aria-label={`Remove ${t.label}`} onClick={() => setConfirming(t)}>
                          Remove
                        </Button>
                      </li>
                    )
                  )}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
}

const used = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

const KIND_OPTIONS = KB_TAG_KINDS.map((k) => ({ value: k, label: KB_TAG_KIND_LABELS[k] }));

/* ── making one from here ────────────────────────────────────────────────── */

function NewTag({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<KbTagKind>("brand");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // until somebody picks one, the disc chosen is the one the server would
  // choose anyway, so the preview is honest rather than a placeholder grey
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
        <Field label="New tag" error={error}>
          <TextInput
            value={label}
            data-autofocus
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) save();
            }}
          />
        </Field>
        <Button disabled={busy || !label.trim()} onClick={save}>
          Add tag
        </Button>
      </div>
      <div className="pt-field">
        <span className="pt-field-label">Kind</span>
        <Tray options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="New tag kind" />
      </div>
      <ColourDiscs value={shown} onChange={setColor} label="New tag colour" />
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
      <Field label="Name" error={error}>
        <TextInput
          value={label}
          aria-label={`Rename ${tag.label}`}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <div className="pt-field">
        <span className="pt-field-label">Kind</span>
        <Tray options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel={`Kind for ${tag.label}`} />
      </div>
      <ColourDiscs value={color} onChange={setColor} label={`Colour for ${tag.label}`} />
      <div className="tgm-cbtn">
        <Button kind="quiet" size={32} onClick={onClose}>
          Cancel
        </Button>
        <Button size={32} disabled={busy || !label.trim()} onClick={save}>
          Save tag
        </Button>
      </div>
    </div>
  );
}
