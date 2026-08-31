/* WHAT THIS JOB STILL WANTS FROM YOU — the attention strip.

   The card's other faces are a RECORD: the diary says what happened, the
   money block says what was billed, the checklist says what the plan is.
   None of them say what is still OPEN, and "the first thing you see" cannot
   live behind a tab — so the strip pins above the tab row, on every face,
   and is ABSENT on a quiet job. A strip that renders empty furniture on the
   nine jobs in ten with nothing outstanding would teach people to ignore it.

   FOUR SOURCES, ONE ORDER OF SEVERITY:

     flag       a HeyTiff flag raised against this job — the only one of the
                four that is a HeyTiff verdict, so it is the only one allowed
                to be red.
     sm8flag    a note ServiceM8 marked "action required". AMBER, never red
                (slice 4's law: nobody ever clears it, so it is a bookmark
                somebody left, not a severity) — and only while the job is
                open, which is the same rule the band chip it replaces used.
     task       an open task born from a note written on this job. The tasks
                table carries no job column BY DESIGN, so the join is the
                note's own `applied.taskIds` — the journal's trick, used here
                for the first time on a card.
     mention    a ServiceM8 note that @mentions one of the crew and has not
                been answered. A SUGGESTION, never an action: it offers to
                become a task and nothing is created until a person says so.

   STRIP = STATE, STORY = RECORD. Every one of these also exists in the diary
   as history; clearing the strip never rewrites it.

   PURE. The reads that feed it are three cheap queries against our own
   tables; the deciding is here where a test can see it. */

import type { Severity } from "./note-brain";

/** How many rows the strip shows before it stops. Three is the whole design:
    a strip that lists nine things is a face, and a face is a tab. */
export const ATTENTION_SHOWN = 3;

export type AttentionItem =
  | {
      kind: "flag";
      key: string;
      id: string;
      message: string;
      severity: Severity;
      /** Who raised it and when, as one already-formatted fragment or null. */
      raised: string | null;
    }
  | {
      kind: "sm8flag";
      key: string;
      noteUuid: string;
      text: string;
      author: string | null;
      /** The naive ServiceM8 stamp, for the day the row names. */
      at: string | null;
    }
  | {
      kind: "task";
      key: string;
      id: string;
      title: string;
      assignee: string | null;
      dueDate: string | null;
      /** True when `dueDate` is behind the day the caller passed in. */
      overdue: boolean;
    }
  | {
      kind: "mention";
      key: string;
      noteUuid: string;
      text: string;
      author: string | null;
      at: string | null;
      /** Everyone the note named, in ServiceM8's own words. `staffId` is set
          only where `integration_links` actually links that person to a
          HeyTiff staff card — a name match is NOT a link (one truth per
          staff member), so an unlinked person arrives named and unassigned
          rather than assigned to a guess. */
      named: { name: string; staffId: string | null }[];
    };

/** A HeyTiff flag as the strip needs it. */
export type AttentionFlag = {
  id: string;
  message: string;
  severity: Severity;
  raised: string | null;
};

/** An open task the note join found. */
export type AttentionTask = {
  id: string;
  title: string;
  assignee: string | null;
  dueDate: string | null;
};

/** One of ServiceM8's own notes, as the two mirror-fed sources read it. */
export type AttentionNote = {
  remoteId: string;
  text: string;
  author: string | null;
  at: string | null;
  actionRequired: boolean;
  /** The handles this note mentions, already matched against the roster. */
  handles: string[];
};

export type AttentionInputs = {
  flags: readonly AttentionFlag[];
  tasks: readonly AttentionTask[];
  notes: readonly AttentionNote[];
  /** ServiceM8's status word for the card's job. A closed job's flagged and
      mentioning notes are HISTORY — the diary keeps them and the strip says
      nothing, which is the difference between a record and an alarm. */
  jobOpen: boolean;
  /** Note uuids somebody has already answered — a task made, or a decision
      that it wasn't work. Dismissed stays dismissed. */
  answered: ReadonlySet<string>;
  /** Who each handle turns out to be. A handle with no entry is a mention of
      somebody the roster doesn't know and is dropped: naming a person we
      can't identify is worse than staying quiet. */
  people: ReadonlyMap<string, { name: string; staffId: string | null }>;
  /** The account's today, for the overdue reading. */
  today: string;
};

export type JobAttention = {
  /** What the strip draws, worst first, capped. */
  items: AttentionItem[];
  /** How many there are in total — the strip's own count, so "3 open" can be
      honest on a job with five. */
  total: number;
};

/* THE ORDER, and why each one sits where it does.

   An urgent HeyTiff flag outranks everything: somebody in this workspace
   said this job is wrong. A warn flag and ServiceM8's own bookmark rank
   together but the flag goes first, because ours was raised deliberately and
   theirs is a box somebody ticked. An overdue task beats a task that isn't.
   A suggestion is last of all — it isn't work yet, and the strip must never
   let a maybe push a definitely off the bottom. */
function rank(item: AttentionItem): number {
  switch (item.kind) {
    case "flag":
      return item.severity === "urgent" ? 0 : item.severity === "warn" ? 2 : 5;
    case "sm8flag":
      return 3;
    case "task":
      return item.overdue ? 1 : 4;
    case "mention":
      return 6;
  }
}

/** Everything still open on this job, worst first. */
export function buildJobAttention(inputs: AttentionInputs): JobAttention {
  const items: AttentionItem[] = [];

  for (const f of inputs.flags) {
    items.push({
      kind: "flag",
      key: `flag:${f.id}`,
      id: f.id,
      message: f.message,
      severity: f.severity,
      raised: f.raised,
    });
  }

  for (const t of inputs.tasks) {
    items.push({
      kind: "task",
      key: `task:${t.id}`,
      id: t.id,
      title: t.title,
      assignee: t.assignee,
      dueDate: t.dueDate,
      /* A string compare, not a Date: both sides are ISO days in the
         account's own zone, and parsing them into instants is how a job in
         Perth reads as overdue in Sydney. */
      overdue: !!t.dueDate && t.dueDate < inputs.today,
    });
  }

  /* The mirror's two signals. Both go silent the moment the job closes, and
     both go silent for good once somebody has answered them. */
  if (inputs.jobOpen) {
    for (const n of inputs.notes) {
      if (inputs.answered.has(n.remoteId)) continue;

      if (n.actionRequired) {
        items.push({
          kind: "sm8flag",
          key: `sm8flag:${n.remoteId}`,
          noteUuid: n.remoteId,
          text: n.text,
          author: n.author,
          at: n.at,
        });
        /* One row per note. A flagged note that also mentions somebody is
           still one thing that needs dealing with, and the flag is the
           louder half — two rows would be the same sentence twice. */
        continue;
      }

      const named = n.handles
        .map((h) => inputs.people.get(h))
        .filter((p): p is { name: string; staffId: string | null } => !!p);
      if (named.length === 0) continue;

      items.push({
        kind: "mention",
        key: `mention:${n.remoteId}`,
        noteUuid: n.remoteId,
        text: n.text,
        author: n.author,
        at: n.at,
        named,
      });
    }
  }

  items.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    /* Same weight: the newest first, and a stable key breaks the last tie so
       two renders of the same data never disagree about the order. */
    const at = (i: AttentionItem) => ("at" in i ? (i.at ?? "") : "");
    if (at(a) !== at(b)) return at(a) < at(b) ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { items: items.slice(0, ATTENTION_SHOWN), total: items.length };
}

/** What the strip's own count says. Never "0 open" — a quiet job has no
    strip at all. */
export function attentionCountLabel(total: number): string {
  return total === 1 ? "1 open" : `${total} open`;
}
