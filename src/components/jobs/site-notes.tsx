"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { addSiteNote, changeSiteNote, readSiteNoteCount, readSiteNotes, removeSiteNote } from "@/app/actions/site-notes";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextArea } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { unitWords } from "@/lib/sites/site-key";
import { KIND_WORDS, SITE_NOTE_KINDS, SITE_NOTE_MAX, type SiteNoteKind, type SiteNoteRow, type SiteNotesRead } from "@/lib/sites/site-notes";
import { jobPageHref } from "@/lib/shell/links";
import "./site-notes.css";

/* SITE NOTES (Isaac, 14 November 2026, on https://claude.ai/artifact/DqJvanQJMJgjs5ZTRySYpB:
   "site notes should be a pop up, there can be a lot of information", "other
   jobs that we've done in the building. Issues that we found ... Access can be
   a section", "a star or a asterisk ... maybe even colour"; then "Build all as
   recommended").

   The button sits under the address in the job's facts. It says "Site notes",
   with the orange asterisk before its word when the site has notes for this
   job, and plain with none (call 13).

   The pop-up is a dialog (rule 36), 880 wide, its body scrolling inside
   itself on a long building. Left: Access (the codes at 20, to read at the
   gate), Issues found, and Other notes when there are any; each row says who
   wrote it, when, and on which job. Right: Other jobs here, every job at the
   building, Still open on one not finished. The building's notes show on
   every job there; a unit's show only on that unit's jobs, under its name.
   Add a note sits beside the title; a row's Change note opens it in place,
   with Remove note. A change or a removal keeps the old words in history,
   never shown. */

/** The orange asterisk: the site has notes. */
function Asterisk() {
  return (
    <svg className="stn-mark" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" />
    </svg>
  );
}

/** The mark on the button: how many notes the job's site has for it. Reads
    again whenever the pop-up changes them. */
export function useSiteNoteCount(jobUuid: string | null): [number | null, (n: number) => void] {
  const [count, setCount] = useState<{ job: string; n: number } | null>(null);
  useEffect(() => {
    if (!jobUuid) return;
    let live = true;
    readSiteNoteCount(jobUuid).then(
      (n) => live && n !== null && setCount({ job: jobUuid, n }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [jobUuid]);
  const set = useCallback((n: number) => jobUuid && setCount({ job: jobUuid, n }), [jobUuid]);
  return [count && count.job === jobUuid ? count.n : null, set];
}

/** The button and its pop-up: what the facts card puts under the address. */
export function SiteNotes({ jobUuid }: { jobUuid: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useSiteNoteCount(jobUuid);
  return (
    <>
      <SiteNotesButton marked={(count ?? 0) > 0} onOpen={() => setOpen(true)} />
      {open && <SiteNotesDialog jobUuid={jobUuid} onClose={() => setOpen(false)} onCount={setCount} />}
    </>
  );
}

export function SiteNotesButton({ marked, onOpen }: { marked: boolean; onOpen: () => void }) {
  return (
    <Button kind="second" size={32} className="stn-btn" icon={marked ? <Asterisk /> : undefined} onClick={onOpen} aria-haspopup="dialog">
      {marked ? (
        <>
          Site notes<span className="stn-sr">, the site has notes</span>
        </>
      ) : (
        "Site notes"
      )}
    </Button>
  );
}

type Editing = { kind: "add"; preset: SiteNoteKind } | { kind: "change"; id: string } | null;

export function SiteNotesDialog({
  jobUuid,
  onClose,
  onCount,
  first,
}: {
  jobUuid: string;
  onClose: () => void;
  onCount?: (n: number) => void;
  /** the site's notes when the opener already has them: nothing is read on opening */
  first?: SiteNotesRead;
}) {
  const [read, setRead] = useState<SiteNotesRead | null>(first ?? null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    const r = await readSiteNotes(jobUuid).catch(() => null);
    if (!r) return setFailed(true);
    setRead(r);
    onCount?.(r.notes.length);
  }, [jobUuid, onCount]);

  useEffect(() => {
    if (first) return;
    let live = true;
    readSiteNotes(jobUuid).then(
      (r) => {
        if (!live) return;
        if (!r) return setFailed(true);
        setRead(r);
        onCount?.(r.notes.length);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [jobUuid, onCount, first]);

  const saved = async () => {
    setEditing(null);
    await load();
  };

  const where = read ? [read.street, read.place].filter(Boolean).join(", ") : "";
  return (
    <Dialog
      heading="Site notes"
      under={where || " "}
      width={880}
      onClose={onClose}
      aside={
        <>
          {read && !read.noSite && (
            <Button kind="second" size={36} onClick={() => setEditing({ kind: "add", preset: "access" })} disabled={editing?.kind === "add"}>
              Add a note
            </Button>
          )}
          <IconButton glyph="close" label="Close site notes" onClick={onClose} />
        </>
      }
    >
      <div className="stn">
        {failed ? (
          <p className="stn-quiet">Site notes didn&rsquo;t open. Close them and try again.</p>
        ) : !read ? (
          <p className="stn-quiet">Reading the site&rsquo;s notes</p>
        ) : read.noSite ? (
          <p className="stn-quiet">The job&rsquo;s address has no street number and street, so notes can&rsquo;t be kept on its site.</p>
        ) : (
          <div className="stn-cols">
            <div className="stn-col">
              {editing?.kind === "add" && (
                <NoteForm
                  jobUuid={jobUuid}
                  read={read}
                  initial={{ kind: editing.preset, words: "", whole: true, video: null }}
                  onCancel={() => setEditing(null)}
                  onSaved={saved}
                />
              )}
              {SITE_NOTE_KINDS.map((kind) => {
                const rows = read.notes.filter((n) => n.kind === kind);
                if (kind === "other" && rows.length === 0) return null;
                return (
                  <NoteSection
                    key={kind}
                    kind={kind}
                    rows={rows}
                    read={read}
                    jobUuid={jobUuid}
                    editing={editing}
                    onEdit={setEditing}
                    onSaved={saved}
                    adding={editing?.kind === "add"}
                  />
                );
              })}
            </div>
            <div className="stn-col">
              <Group heading="Other jobs here">
                {read.jobs.length === 0 ? (
                  <p className="stn-quiet stn-pad">No other jobs at this address</p>
                ) : (
                  <ul className="stn-rows">
                    {read.jobs.map((j) => (
                      <li key={j.uuid} className="stn-row">
                        <div className="stn-words">
                          <p className="stn-name">
                            {j.number && <span className="stn-num">{j.number}</span>} {j.title}
                          </p>
                          <p className="stn-meta">{j.line}</p>
                        </div>
                        <div className="stn-doors">
                          {j.open && <StateWord tone="look">Still open</StateWord>}
                          <Button kind="quiet" size={32} href={jobPageHref(j.uuid)} onClick={onClose}>
                            Open job
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="stn-group" aria-labelledby={id}>
      <h3 className="stn-label" id={id}>
        {heading}
      </h3>
      {children}
    </section>
  );
}

const ADD_WORDS: Record<SiteNoteKind, string> = { access: "Add access note", issue: "Add issue found", other: "Add other note" };

function NoteSection({
  kind,
  rows,
  read,
  jobUuid,
  editing,
  onEdit,
  onSaved,
  adding,
}: {
  kind: SiteNoteKind;
  rows: SiteNoteRow[];
  read: SiteNotesRead;
  jobUuid: string;
  editing: Editing;
  onEdit: (e: Editing) => void;
  onSaved: () => void;
  adding: boolean;
}) {
  const building = rows.filter((r) => r.unit === null);
  const unit = rows.filter((r) => r.unit !== null);
  const list = (items: SiteNoteRow[]) => (
    <ul className="stn-rows">
      {items.map((n) =>
        editing?.kind === "change" && editing.id === n.id ? (
          <li key={n.id} className="stn-row stn-row--form">
            <NoteForm
              jobUuid={jobUuid}
              read={read}
              id={n.id}
              initial={{ kind: n.kind, words: n.words, whole: n.unit === null, video: n.video?.ref ?? null }}
              onCancel={() => onEdit(null)}
              onSaved={onSaved}
            />
          </li>
        ) : (
          <NoteRowView key={n.id} note={n} onChange={() => onEdit({ kind: "change", id: n.id })} />
        ),
      )}
    </ul>
  );
  return (
    <Group heading={KIND_WORDS[kind].section}>
      {building.length > 0 && list(building)}
      {unit.length > 0 && read.unit && (
        <>
          <h4 className="stn-unit">{unitWords(read.unit)}</h4>
          {list(unit)}
        </>
      )}
      {rows.length === 0 && !adding && (
        <p className="stn-pad">
          <Button kind="second" size={32} onClick={() => onEdit({ kind: "add", preset: kind })}>
            {ADD_WORDS[kind]}
          </Button>
        </p>
      )}
    </Group>
  );
}

function NoteRowView({ note, onChange }: { note: SiteNoteRow; onChange: () => void }) {
  const [first, ...rest] = note.words.split("\n");
  const meta = [note.by, note.when, note.job?.number ? `on job ${note.job.number}` : null].filter(Boolean).join(", ");
  return (
    <li className="stn-row">
      <div className="stn-words">
        <p className={note.kind === "access" ? "stn-code" : "stn-name"}>{first}</p>
        {rest.length > 0 && <p className="stn-more">{rest.join("\n")}</p>}
        {meta && <p className="stn-meta">{meta}</p>}
      </div>
      <div className="stn-doors">
        {note.video?.url && (
          <Button kind="quiet" size={32} href={note.video.url} target="_blank" rel="noreferrer">
            Play video
          </Button>
        )}
        {!note.video?.url && note.video?.inSm8 && (
          <Button kind="quiet" size={32} href={note.video.inSm8} target="_blank" rel="noreferrer">
            Play video in ServiceM8
          </Button>
        )}
        <Button kind="quiet" size={32} onClick={onChange}>
          Change note
        </Button>
      </div>
    </li>
  );
}

type Draft = { kind: SiteNoteKind; words: string; whole: boolean; video: string | null };

type Written = { ok: true; id: string } | { ok: false; error: string };
const DIDNT_SAVE: Written = { ok: false, error: "The note didn't save. Try again." };
const NOT_REMOVED: Written = { ok: false, error: "The note wasn't removed. Try again." };

function NoteForm({
  jobUuid,
  read,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  jobUuid: string;
  read: SiteNotesRead;
  /** the note being changed; none when adding */
  id?: string;
  initial: Draft;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const kindLabel = useId();
  const whereLabel = useId();

  const save = async () => {
    if (!draft.words.trim()) return setError("Write the note first.");
    setBusy(true);
    setError(null);
    const input = { jobUuid, kind: draft.kind, words: draft.words, whole: draft.whole, video: draft.kind === "issue" ? draft.video : null };
    const done = await (id ? changeSiteNote({ ...input, id }) : addSiteNote(input)).catch(() => DIDNT_SAVE);
    if (!done.ok) {
      setError(done.error);
      setBusy(false);
      return;
    }
    onSaved();
  };

  const remove = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    const done = await removeSiteNote({ jobUuid, id }).catch(() => NOT_REMOVED);
    if (!done.ok) {
      setError(done.error);
      setBusy(false);
      return;
    }
    onSaved();
  };

  return (
    <form
      className="stn-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="stn-choices">
        <div className="pt-field">
          <span className="pt-field-label" id={kindLabel}>
            Kind
          </span>
          <Tray
            ariaLabel="Kind"
            value={draft.kind}
            onChange={(kind) => setDraft((d) => ({ ...d, kind }))}
            options={SITE_NOTE_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k].choice }))}
            disabled={busy}
          />
        </div>
        {read.unit && (
          <div className="pt-field">
            <span className="pt-field-label" id={whereLabel}>
              For
            </span>
            <Tray
              ariaLabel="For"
              value={draft.whole ? "building" : "unit"}
              onChange={(v) => setDraft((d) => ({ ...d, whole: v === "building" }))}
              options={[
                { value: "building", label: "Whole building" },
                { value: "unit", label: unitWords(read.unit) },
              ]}
              disabled={busy}
            />
          </div>
        )}
      </div>
      <Field label="Note" error={error}>
        <TextArea
          className="stn-area"
          rows={3}
          maxLength={SITE_NOTE_MAX}
          value={draft.words}
          data-autofocus
          autoFocus
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, words: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
        />
      </Field>
      {draft.kind === "issue" && read.videos.length > 0 && (
        <Field label="Video">
          <Chooser
            value={draft.video ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, video: v || null }))}
            options={[{ value: "", label: "No video" }, ...read.videos.map((v) => ({ value: v.ref, label: v.name }))]}
            disabled={busy}
          />
        </Field>
      )}
      {removing ? (
        <div className="stn-formfoot">
          <p className="stn-ask">Remove this note?</p>
          <Button kind="second" size={36} onClick={() => setRemoving(false)} disabled={busy}>
            Keep note
          </Button>
          <Button kind="delete" size={36} onClick={() => void remove()} disabled={busy}>
            Remove note
          </Button>
        </div>
      ) : (
        <div className="stn-formfoot">
          {id && (
            <Button kind="delete" size={36} className="stn-remove" onClick={() => setRemoving(true)} disabled={busy}>
              Remove note
            </Button>
          )}
          <Button kind="second" size={36} onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button kind="main" size={36} type="submit" disabled={busy} aria-busy={busy || undefined}>
            {id ? "Save change" : "Save note"}
          </Button>
        </div>
      )}
    </form>
  );
}
