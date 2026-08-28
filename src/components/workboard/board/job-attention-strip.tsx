"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { DateField } from "@/components/ui/date-field";
import {
  attentionCountLabel,
  type AttentionItem,
  type JobAttention,
} from "@/lib/workboard/job-attention";
import { taskTitleFromNote } from "@/lib/workboard/sm8-mentions";

/* THE ATTENTION STRIP — what this job still wants from you, above the tabs.

   NOT A TAB, and that is the whole design: a tab is a click, and "the first
   thing you see" cannot live behind one. So the strip pins under the header
   and over the tab row, shows on every face, and is ABSENT the moment there
   is nothing open — a strip that renders empty furniture on the nine jobs in
   ten with nothing outstanding is a strip people learn to look past.

   STRIP = STATE, STORY = RECORD. Everything here is also in the diary as
   history. Clearing a row never rewrites it.

   IT ABSORBS SLICE 4'S BAND CHIP. "⚑ 1 flagged note ›" was the honest home
   for a ServiceM8 bookmark while there was no strip; now that there is one,
   the flag has a row that says WHAT the note actually said, which a chip
   never could.

   THE SUGGESTION IS NOT AN ACTION. A mention becomes a task only when a
   person presses the button, names who it is for and lets it save — the
   review-before-save law, unchanged. Nothing here writes on its own. */

export function JobAttentionStrip({
  attention,
  assignable,
  busy,
  onClearFlag,
  onOpenNote,
  onMakeTask,
  onDismissNote,
}: {
  attention: JobAttention;
  /** Who a task can be given to — sent with the strip so the form opens
      instantly rather than fetching a picker under the reader's thumb. */
  assignable: readonly { id: string; name: string }[];
  busy: boolean;
  onClearFlag: (id: string) => void;
  /** Opens the Diary at the ServiceM8 note this row is about. */
  onOpenNote: (noteUuid: string) => void;
  onMakeTask: (input: {
    noteUuid: string;
    title: string;
    assigneeId: string;
    dueDate: string | null;
  }) => void;
  onDismissNote: (noteUuid: string) => void;
}) {
  /* Which suggestion has its form open. One at a time: two open forms on a
     three-row strip is a dialog pretending to be a list. */
  const [drafting, setDrafting] = useState<string | null>(null);

  if (attention.items.length === 0) return null;

  return (
    <section className="wb2-jcatt" aria-label="Needs attention">
      <div className="wb2-jcatthd">
        <span className="wb2-sect">Needs attention</span>
        <span className="wb2-chip warn">{attentionCountLabel(attention.total)}</span>
      </div>
      {attention.items.map((item) => (
        <AttentionRow
          key={item.key}
          item={item}
          assignable={assignable}
          busy={busy}
          drafting={drafting === item.key}
          onDraft={(on) => setDrafting(on ? item.key : null)}
          onClearFlag={onClearFlag}
          onOpenNote={onOpenNote}
          onMakeTask={onMakeTask}
          onDismissNote={onDismissNote}
        />
      ))}
      {/* THE COUNT IS THE ONLY OVERFLOW. There is no "show all" — three is
          the cap by design, and a fourth row is a job whose real problem is
          that nobody has dealt with the first three. */}
      {attention.total > attention.items.length && (
        <p className="wb2-jcattmore">
          {`and ${attention.total - attention.items.length} more — the diary has them all`}
        </p>
      )}
    </section>
  );
}

function AttentionRow({
  item,
  assignable,
  busy,
  drafting,
  onDraft,
  onClearFlag,
  onOpenNote,
  onMakeTask,
  onDismissNote,
}: {
  item: AttentionItem;
  assignable: readonly { id: string; name: string }[];
  busy: boolean;
  drafting: boolean;
  onDraft: (on: boolean) => void;
  onClearFlag: (id: string) => void;
  onOpenNote: (noteUuid: string) => void;
  onMakeTask: (input: {
    noteUuid: string;
    title: string;
    assigneeId: string;
    dueDate: string | null;
  }) => void;
  onDismissNote: (noteUuid: string) => void;
}) {
  const face = faceOf(item);

  return (
    <div className={"wb2-jcattrow" + (drafting ? " open" : "")}>
      <span className={`wb2-jcatttile ${face.tone}`} aria-hidden="true">
        <Icon name={face.icon} size={13} />
      </span>
      <span className="wb2-jcatttext">
        <b>{face.title}</b>
        {face.meta && <em>{face.meta}</em>}
      </span>
      <span className="wb2-jcattacts">
        {item.kind === "flag" && (
          <button
            className="wb2-chip"
            disabled={busy}
            onClick={() => onClearFlag(item.id)}
            title="Stop this flag pulsing — the note that raised it stays in the diary"
          >
            Clear
          </button>
        )}
        {item.kind === "sm8flag" && (
          <button className="wb2-chip" onClick={() => onOpenNote(item.noteUuid)}>
            Open in the diary
            <i className="wb2-shcar" aria-hidden>
              ›
            </i>
          </button>
        )}
        {item.kind === "mention" && !drafting && (
          <>
            <button className="wb2-chip blue" disabled={busy} onClick={() => onDraft(true)}>
              Make it a task
            </button>
            <button
              className="wb2-chip"
              disabled={busy}
              onClick={() => onDismissNote(item.noteUuid)}
              title="Not work — and it stays dismissed"
            >
              Not work
            </button>
          </>
        )}
      </span>
      {item.kind === "mention" && drafting && (
        <TaskDraft
          item={item}
          assignable={assignable}
          busy={busy}
          onCancel={() => onDraft(false)}
          onSave={(input) => {
            onDraft(false);
            onMakeTask({ noteUuid: item.noteUuid, ...input });
          }}
        />
      )}
    </div>
  );
}

/** The review card, in miniature and without a model.

    The full review card exists for words somebody DICTATED, where what the
    sentence means is genuinely uncertain. A ServiceM8 note that names a
    person is not that: the who is a string join and the what is the note's
    own words, so a form with both already in it is more honest — and free —
    than asking a model to draft what the reader is about to edit anyway. */
function TaskDraft({
  item,
  assignable,
  busy,
  onCancel,
  onSave,
}: {
  item: Extract<AttentionItem, { kind: "mention" }>;
  assignable: readonly { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { title: string; assigneeId: string; dueDate: string | null }) => void;
}) {
  const [title, setTitle] = useState(() => taskTitleFromNote(item.text));
  /* PREFILLED ONLY WHERE THE LINK IS REAL. `staffId` is set from
     integration_links and nowhere else — a name that merely looks like a
     staff card's is not a link — so an unlinked person leaves this empty and
     the reader says who. A task on the wrong person is worse than a task on
     nobody, which is why this never guesses. */
  const [assigneeId, setAssigneeId] = useState(
    () => item.named.find((n) => n.staffId)?.staffId ?? ""
  );
  const [dueDate, setDueDate] = useState("");
  const unlinked = item.named.filter((n) => !n.staffId).map((n) => n.name);

  return (
    <div className="wb2-jcattform">
      <label className="wb2-jcattfield">
        <span>What needs doing</span>
        <input
          className="wb2-fi"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          aria-label="What needs doing"
        />
      </label>
      <label className="wb2-jcattfield short">
        <span>For</span>
        <select
          className="wb2-sel"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          aria-label="Who the task is for"
        >
          <option value="">Say who…</option>
          {assignable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="wb2-jcattfield short">
        <span>By</span>
        {/* THE HOUSE'S OWN PICKER, never `<input type="date">` — a guard test
            bans that everywhere, because the native control renders dd/mm in
            one browser and mm/dd in the next and a wrong month is silent. */}
        <DateField
          value={dueDate}
          onChange={(iso) => setDueDate(iso ?? "")}
          clearable
          aria-label="Due date"
        />
      </div>
      <div className="wb2-jcattsave">
        <button
          className="wb2-chip blue"
          disabled={busy || !title.trim() || !assigneeId}
          onClick={() => onSave({ title: title.trim(), assigneeId, dueDate: dueDate || null })}
        >
          Save the task
        </button>
        <button className="wb2-chip" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {/* THE HONEST LINE, and it is not hint text — it names a real gap in
          the data the reader is looking at, which no amount of design can
          explain away: ServiceM8 knows this person, HeyTiff doesn't know
          they're the same person yet. */}
      {unlinked.length > 0 && !assigneeId && (
        <p className="wb2-jcattgap">
          {`${unlinked.join(" and ")} ${unlinked.length === 1 ? "isn't" : "aren't"} linked to a HeyTiff staff card yet, so say who this is for.`}
        </p>
      )}
    </div>
  );
}

/* ── how each kind reads ── */

type Face = {
  icon: "alert" | "servicem8" | "listCheck" | "user";
  tone: "dan" | "warn" | "cy" | "plain";
  title: string;
  meta: string | null;
};

/** The day part of a naive ServiceM8 stamp, said the Australian way. */
const dayOf = (at: string | null): string | null =>
  at && at.length >= 10 ? fmtAuWeekdayDayMonth(at.slice(0, 10)) : null;

/* Quoted, because the row is REPEATING somebody: a note's words in a strip
   that also carries our own sentences needs to say which is which, and a
   quote mark does it without a label. Clipped so one rambling note can't
   push the two rows under it off the strip. */
const quoted = (text: string, limit = 120): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return `“${one.length > limit ? `${one.slice(0, limit - 1).trimEnd()}…` : one}”`;
};

function faceOf(item: AttentionItem): Face {
  switch (item.kind) {
    case "flag":
      return {
        icon: "alert",
        tone: item.severity === "urgent" ? "dan" : item.severity === "warn" ? "warn" : "plain",
        title: item.message,
        meta: item.raised ? `Flagged ${fmtAuWeekdayDayMonth(item.raised.slice(0, 10))}` : "Flagged",
      };
    case "sm8flag":
      /* AMBER, NEVER RED — slice 4's law, and the reason is measured: 74
         flagged notes live across 49 jobs and nobody has ever cleared one.
         It is a bookmark somebody left, not a severity. */
      return {
        icon: "servicem8",
        tone: "warn",
        title: quoted(item.text),
        meta: [item.author, dayOf(item.at), "Flagged in ServiceM8"].filter(Boolean).join(" · "),
      };
    case "task":
      return {
        icon: "listCheck",
        tone: item.overdue ? "dan" : "plain",
        title: item.title,
        meta: [
          "Task",
          item.assignee,
          item.dueDate
            ? `${item.overdue ? "was due" : "due"} ${fmtAuWeekdayDayMonth(item.dueDate)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "mention":
      return {
        icon: "user",
        tone: "cy",
        /* The PERSON leads, because that is what makes this row different
           from every other note in the diary: somebody was asked. */
        title: `${item.named.map((n) => n.name).join(" and ")} — ${quoted(item.text, 90)}`,
        meta: [item.author, dayOf(item.at), "Mentioned in ServiceM8"].filter(Boolean).join(" · "),
      };
  }
}
