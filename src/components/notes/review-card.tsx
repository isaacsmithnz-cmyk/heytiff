"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { SEVERITIES, type NoteProposal, type NoteStaff } from "@/lib/workboard/note-brain";
import { describeJob, searchJobs, type JobCandidate } from "@/lib/workboard/note-match";
import type { ConfirmedNote, NoteTarget } from "@/app/actions/workboard-notes";

/* THE REVIEW — one card, every posture.

   This is the whole argument of the token track in one file. Before it, the
   pill owned an editable review and the four other controls owned nothing:
   dictating into a box labelled "Notes for the visit" could not raise the
   task it described, so a bridge button was bolted on to hand the text to
   the pill. Now every posture ends here.

   THE ENGINE'S CONTRACT IS UNCHANGED and must stay that way: the server
   never applies what the model produced, it applies what came back from THIS
   card. Every row is editable and droppable; nothing is saved that nobody
   looked at. A misheard word costs a dismissed card, never a task assigned
   to the wrong person. */

export type Draft = {
  tasks: {
    on: boolean;
    title: string;
    detail: string;
    assigneeId: string | null;
    dueDate: string;
    hint: string;
    dueHint: string;
  }[];
  bringItems: { on: boolean; text: string }[];
  flags: { on: boolean; message: string; severity: string }[];
  progressBullets: { on: boolean; text: string }[];
  commissioningEntries: { on: boolean; text: string }[];
  issueEntries: { on: boolean; summary: string; equipmentRef: string }[];
  /** LEARN — "Worth teaching everyone". Ticked rows publish to the KB. */
  kbEntries: { on: boolean; title: string; body: string }[];
  /** Debrief leftovers — the lines kept as one grouped note. */
  noteLines: { on: boolean; text: string }[];
};

export function toDraft(p: NoteProposal): Draft {
  return {
    tasks: p.tasks.map((t) => ({
      on: true,
      title: t.title,
      detail: t.detail,
      assigneeId: t.assigneeId,
      /* Seeded from the model's resolved day. "Tomorrow" is a date, and
         making someone read the word and then type the date is asking them
         to do the easy half of the job the note already did. */
      dueDate: t.dueDate,
      hint: t.assigneeHint,
      /* What was actually SAID about when — "before Monday's visit (3
         August)". The date box starts empty because that phrase isn't a
         date, but throwing the words away meant the one bit of the note
         that gave a task its urgency never reached the person doing it. */
      dueHint: t.dueHint,
    })),
    bringItems: p.bringItems.map((text) => ({ on: true, text })),
    flags: p.flags.map((f) => ({ on: true, message: f.message, severity: f.severity })),
    progressBullets: p.progressBullets.map((text) => ({ on: true, text })),
    commissioningEntries: p.commissioningEntries.map((e) => ({ on: true, text: e.body })),
    issueEntries: p.issueEntries.map((e) => ({
      on: true,
      summary: e.body,
      equipmentRef: e.equipmentHint,
    })),
    kbEntries: p.kbEntries.map((k) => ({ on: true, title: k.title, body: k.body })),
    noteLines: p.noteLines.map((text) => ({ on: true, text })),
  };
}

export function toConfirmed(d: Draft): ConfirmedNote {
  return {
    tasks: d.tasks
      .filter((t) => t.on && t.title.trim() && t.assigneeId)
      .map((t) => ({
        title: t.title,
        detail: t.detail,
        assigneeId: t.assigneeId,
        dueDate: t.dueDate || null,
      })),
    bringItems: d.bringItems.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    flags: d.flags
      .filter((f) => f.on && f.message.trim())
      .map((f) => ({ message: f.message, severity: f.severity })),
    progressBullets: d.progressBullets.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    commissioningEntries: d.commissioningEntries
      .filter((e) => e.on && e.text.trim())
      .map((e) => e.text),
    issueEntries: d.issueEntries
      .filter((e) => e.on && e.summary.trim())
      .map((e) => ({ summary: e.summary, equipmentRef: e.equipmentRef })),
    kbEntries: d.kbEntries
      .filter((k) => k.on && k.title.trim() && k.body.trim())
      .map((k) => ({ title: k.title, body: k.body })),
    noteLines: d.noteLines.filter((l) => l.on && l.text.trim()).map((l) => l.text),
  };
}

/* Every bucket of a ConfirmedNote is an array, so "nothing is ticked" is just
   "they are all empty". */
export const nothingTicked = (d: Draft): boolean =>
  Object.values(toConfirmed(d)).every((bucket) => bucket.length === 0);

/** What "Keep it in my notes" keeps: the ticked rows, edits included, as the
    lines of one grouped note — because a flag or a reading that names no job
    ISN'T a flag or a reading, it's your note wearing structured clothes.
    Deliberately from the DRAFT, not `toConfirmed`: an unassigned task can't
    be applied, but its words are still words worth keeping.

    Empty when no rows are ticked — the server then keeps the raw transcript
    instead, which is the right floor for a note that never grew rows. The
    plain remark rides first when rows exist, so nothing shown on the card is
    missing from what was kept. */
export function keptLines(d: Draft, plainNote: string): string[] {
  const rows = [
    ...d.tasks
      .filter((t) => t.on && t.title.trim())
      .map((t) => (t.detail.trim() ? `${t.title.trim()} — ${t.detail.trim()}` : t.title.trim())),
    ...d.flags.filter((f) => f.on && f.message.trim()).map((f) => f.message.trim()),
    ...d.bringItems
      .filter((b) => b.on && b.text.trim())
      .map((b) => `Bring next visit: ${b.text.trim()}`),
    ...d.progressBullets.filter((b) => b.on && b.text.trim()).map((b) => b.text.trim()),
    ...d.commissioningEntries.filter((e) => e.on && e.text.trim()).map((e) => e.text.trim()),
    ...d.issueEntries.filter((e) => e.on && e.summary.trim()).map((e) => e.summary.trim()),
    ...d.kbEntries
      .filter((k) => k.on && k.title.trim() && k.body.trim())
      .map((k) => `${k.title.trim()} — ${k.body.trim()}`),
    ...d.noteLines.filter((l) => l.on && l.text.trim()).map((l) => l.text.trim()),
  ];
  if (rows.length === 0) return [];
  const remark = plainNote.trim();
  return remark ? [remark, ...rows] : rows;
}

/** Buckets that are text on somebody else's row and cannot exist without a
    job to sit on. Tasks are deliberately NOT here — `tasks` has no job
    column, so a task from a note stands on its own. */
const jobBound = (d: Draft): boolean => {
  const c = toConfirmed(d);
  return (
    c.bringItems.length > 0 ||
    c.flags.length > 0 ||
    c.progressBullets.length > 0 ||
    c.commissioningEntries.length > 0 ||
    c.issueEntries.length > 0
  );
};

/* WHAT WOULD BE THROWN AWAY IF YOU PRESSED SAVE RIGHT NOW.

   This card used to let you press Save with rows on it that could never be
   saved, and then say "Saved as a note." Isaac dictated two tasks and two
   bring-items, pressed Save, and the database recorded `applied: {}` — the
   tasks had no person on them and a general note has no job to hang a
   bring-list off, so all four were dropped without a word.

   THE JOB RULE IS NOW PER ROW, NOT PER NOTE (Isaac, 2026-08-05). It used to
   refuse every note that named no job, which was right about flags and
   bring-lists and wrong about tasks: "tell Luke to ring the wholesaler back"
   is a real task about no job in particular, and it could not be saved at
   all. So the question the button asks is: is there anything ticked here
   that CANNOT be done? */
export function blockers(d: Draft, hasTarget: boolean): string[] {
  const out: string[] = [];

  if (!hasTarget && jobBound(d)) {
    out.push(
      "Flags, bring-items, progress and issues all hang off a job — say which one, or untick them."
    );
  }
  const unassigned = d.tasks.filter((t) => t.on && t.title.trim() && !t.assigneeId).length;
  if (unassigned) {
    out.push(
      unassigned === 1
        ? "One task still needs a person on it — assign it, or untick it."
        : `${unassigned} tasks still need a person on them — assign them, or untick them.`
    );
  }
  return out;
}

/* The stored severities are lowercase keys — `info`, `warn`, `urgent` — and
   showing the key is showing the database to the user. These are what a
   person picks between. */
const SEVERITY_LABEL: Record<(typeof SEVERITIES)[number], string> = {
  info: "Worth seeing",
  warn: "Needs attention",
  urgent: "Urgent — someone is blocked",
};

/** Where the note is about to go, in the order it was aimed. Rendered as
    fact, not as a menu: by the time this shows, the choice has been made by
    what's ticked and what job is named. */
export function Cascade({
  jobLabel,
  taskCount,
  kbCount = 0,
  noteLineCount = 0,
  fallsThrough,
}: {
  jobLabel: string | null;
  taskCount: number;
  /** Ticked "Worth teaching everyone" rows — its own line because its blast
      radius is the whole org, and that should be readable at the foot. */
  kbCount?: number;
  /** Ticked debrief leftovers, headed for the grouped note. */
  noteLineCount?: number;
  /** Nothing above could take it, so My notes is the destination. */
  fallsThrough: boolean;
}) {
  const notesOn = fallsThrough || noteLineCount > 0;
  return (
    <div className="wb2-casc">
      <div className={"wb2-cascrow" + (jobLabel ? " on" : "")}>
        <span className="wb2-cascn">1</span>
        <span>{jobLabel ? <>Going on <b>{jobLabel}</b></> : "No job named"}</span>
      </div>
      <div className={"wb2-cascrow" + (taskCount ? " on" : "")}>
        <span className="wb2-cascn">2</span>
        <span>
          {taskCount
            ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"} — onto their dashboard`
            : "No tasks for anyone"}
        </span>
      </div>
      <div className={"wb2-cascrow" + (notesOn ? " on" : "")}>
        <span className="wb2-cascn">3</span>
        <span>
          {noteLineCount > 0 ? (
            <>
              {noteLineCount} {noteLineCount === 1 ? "line" : "lines"} — grouped in{" "}
              <b>your notes</b>
            </>
          ) : fallsThrough ? (
            <>Nothing else fits — keep it in <b>your notes</b></>
          ) : (
            "Your notes — not needed"
          )}
        </span>
      </div>
      {kbCount > 0 && (
        <div className="wb2-cascrow on">
          <span className="wb2-cascn">
            <Icon name="sparkles" size={10} />
          </span>
          <span>
            {kbCount} {kbCount === 1 ? "entry" : "entries"} into the <b>knowledge base</b> — the
            whole team
          </span>
        </div>
      )}
    </div>
  );
}

export function ReviewRows({
  draft,
  staff,
  patch,
}: {
  draft: Draft;
  staff: NoteStaff[];
  patch: (fn: (d: Draft) => Draft) => void;
}) {
  return (
    <>
      {draft.tasks.length > 0 && (
        <div className="wb-day">
          <div className="wb-dayhead">Tasks</div>
          {draft.tasks.map((t, i) => (
            <div className="wb-row" key={i}>
              <button
                className={"wb-tick" + (t.on ? " done" : "")}
                onClick={() => patch((d) => ((d.tasks[i].on = !d.tasks[i].on), d))}
                /* Named, not "this task" — three rows all labelled "Skip this
                   task" is three identical buttons to anyone not looking. */
                aria-label={(t.on ? "Skip " : "Include ") + t.title}
              >
                <Icon name="check" size={13} />
              </button>
              <input
                className="wb-inline"
                value={t.title}
                onChange={(e) => patch((d) => ((d.tasks[i].title = e.target.value), d))}
              />
              <select
                className="wb-select"
                value={t.assigneeId ?? ""}
                onChange={(e) => patch((d) => ((d.tasks[i].assigneeId = e.target.value || null), d))}
              >
                <option value="">{t.hint ? `${t.hint} — who?` : "Assign to…"}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
              <input
                className="wb-select"
                type="date"
                aria-label={`Due date — ${t.title}`}
                title={t.dueHint ? `Said: ${t.dueHint}` : undefined}
                value={t.dueDate}
                onChange={(e) => patch((d) => ((d.tasks[i].dueDate = e.target.value), d))}
              />
              {t.dueHint && !t.dueDate && <em className="wb2-capsaid">said: {t.dueHint}</em>}
            </div>
          ))}
        </div>
      )}

      <SimpleRows
        title="Flags for the board"
        rows={draft.flags.map((f) => ({ on: f.on, text: f.message }))}
        onToggle={(i) => patch((d) => ((d.flags[i].on = !d.flags[i].on), d))}
        onEdit={(i, v) => patch((d) => ((d.flags[i].message = v), d))}
        trailing={(i) => (
          <select
            className="wb-select"
            value={draft.flags[i].severity}
            onChange={(e) => patch((d) => ((d.flags[i].severity = e.target.value), d))}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        )}
      />

      <SimpleRows
        title="Bring next visit"
        rows={draft.bringItems.map((b) => ({ on: b.on, text: b.text }))}
        onToggle={(i) => patch((d) => ((d.bringItems[i].on = !d.bringItems[i].on), d))}
        onEdit={(i, v) => patch((d) => ((d.bringItems[i].text = v), d))}
      />

      <SimpleRows
        title="Progress"
        rows={draft.progressBullets.map((b) => ({ on: b.on, text: b.text }))}
        onToggle={(i) => patch((d) => ((d.progressBullets[i].on = !d.progressBullets[i].on), d))}
        onEdit={(i, v) => patch((d) => ((d.progressBullets[i].text = v), d))}
      />

      <SimpleRows
        title="Commissioning"
        rows={draft.commissioningEntries.map((e) => ({ on: e.on, text: e.text }))}
        onToggle={(i) =>
          patch((d) => ((d.commissioningEntries[i].on = !d.commissioningEntries[i].on), d))
        }
        onEdit={(i, v) => patch((d) => ((d.commissioningEntries[i].text = v), d))}
      />

      <SimpleRows
        title="Issues"
        rows={draft.issueEntries.map((e) => ({ on: e.on, text: e.summary }))}
        onToggle={(i) => patch((d) => ((d.issueEntries[i].on = !d.issueEntries[i].on), d))}
        onEdit={(i, v) => patch((d) => ((d.issueEntries[i].summary = v), d))}
      />

      {/* LEARN — the row that publishes. Two fields because the KB card and
          the KB body are genuinely different things: the title is what the
          library shows and search weights, the body is the method itself.
          Framed with its own hint because ticking this one reaches EVERYONE,
          not a job — the only row on the card with that blast radius. */}
      {draft.kbEntries.length > 0 && (
        <div className="wb-day">
          <div className="wb-dayhead">Worth teaching everyone</div>
          {draft.kbEntries.map((k, i) => (
            <div className="wb2-kbrow" key={i}>
              <div className="wb-row">
                <button
                  className={"wb-tick" + (k.on ? " done" : "")}
                  onClick={() => patch((d) => ((d.kbEntries[i].on = !d.kbEntries[i].on), d))}
                  aria-label={(k.on ? "Don't publish " : "Publish ") + k.title}
                >
                  <Icon name="check" size={13} />
                </button>
                <input
                  className="wb-inline"
                  value={k.title}
                  aria-label="Knowledge title"
                  onChange={(e) => patch((d) => ((d.kbEntries[i].title = e.target.value), d))}
                />
              </div>
              <textarea
                className="wb2-notes wb2-kbbody"
                rows={2}
                value={k.body}
                aria-label={`The method — ${k.title}`}
                onChange={(e) => patch((d) => ((d.kbEntries[i].body = e.target.value), d))}
              />
            </div>
          ))}
          <p className="wb2-hint">
            Ticked entries go into the knowledge base for the whole team, with your name and
            today&apos;s date on them.
          </p>
        </div>
      )}

      <SimpleRows
        title="Keeping in your notes"
        rows={draft.noteLines.map((l) => ({ on: l.on, text: l.text }))}
        onToggle={(i) => patch((d) => ((d.noteLines[i].on = !d.noteLines[i].on), d))}
        onEdit={(i, v) => patch((d) => ((d.noteLines[i].text = v), d))}
      />
    </>
  );
}

function SimpleRows({
  title,
  rows,
  onToggle,
  onEdit,
  trailing,
}: {
  title: string;
  rows: { on: boolean; text: string }[];
  onToggle: (i: number) => void;
  onEdit: (i: number, value: string) => void;
  trailing?: (i: number) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="wb-day">
      <div className="wb-dayhead">{title}</div>
      {rows.map((r, i) => (
        <div className="wb-row" key={i}>
          <button
            className={"wb-tick" + (r.on ? " done" : "")}
            onClick={() => onToggle(i)}
            aria-label={r.on ? `Skip ${r.text}` : `Include ${r.text}`}
          >
            <Icon name="check" size={13} />
          </button>
          <input className="wb-inline" value={r.text} onChange={(e) => onEdit(i, e.target.value)} />
          {trailing?.(i)}
        </div>
      ))}
    </div>
  );
}

/* Search the board's jobs, rather than scroll past them.

   Isaac's objection to the dropdown was exact: "instead of saying change it
   above, I'll hit the wrong one." A select is a list you navigate; this is a
   list you narrow. It opens on the matched order (best guess first), takes
   any word off the card — client, service, site or job number — and every
   row says its number so picking is a read, not a gamble. */
export function JobPicker({
  options,
  chosenId,
  onPick,
  onClose,
}: {
  options: JobCandidate[];
  chosenId: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const found = useMemo(() => searchJobs(q, options), [q, options]);

  return (
    <div className="wb2-jobpick">
      <div className="wb2-jobsearch">
        <Icon name="search" size={14} />
        <input
          autoFocus
          className="wb2-jobq"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs — client, service, site or job number"
          aria-label="Search jobs"
        />
        <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close the job search">
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="wb2-joblist" role="listbox" aria-label="Jobs">
        {/* Always reachable: a note that turns out to belong to nothing in
            particular is a real answer, not a dead end — and now it has a
            destination, which is what makes it one. */}
        <button
          type="button"
          role="option"
          aria-selected={!chosenId}
          className={"wb2-jobopt" + (!chosenId ? " on" : "")}
          onClick={() => onPick("")}
        >
          Nothing in particular — keep it in my notes
        </button>
        {found.map((o) => (
          <button
            type="button"
            role="option"
            key={`${o.kind}:${o.id}`}
            aria-selected={o.id === chosenId}
            className={"wb2-jobopt" + (o.id === chosenId ? " on" : "")}
            onClick={() => onPick(`${o.kind}:${o.id}`)}
          >
            {describeJob(o)}
          </button>
        ))}
        {found.length === 0 && (
          <p className="wb2-hint">Nothing on the board matches &ldquo;{q.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}

/** Turn a picker value ("visit:abc") back into a target. */
export function targetOf(picked: string): NoteTarget | null {
  if (!picked) return null;
  const [kind, id] = picked.split(":");
  return kind === "agreement" || kind === "project" || kind === "visit"
    ? { kind: kind as NoteTarget["kind"], id }
    : null;
}
