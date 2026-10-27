import "server-only";

import {
  answerVisit,
  continueNote,
  dismissNote,
  fileNote,
  keepWords,
  routeNote,
  undoNote,
  type FileAsk,
  type FileResult,
  type NoteTarget,
  type RouteResult,
} from "@/app/actions/workboard-notes";
import { looksLikeMove, looksLikeQuestion, priceIntent } from "@/lib/brain/intent";
import { openName, parseMove } from "@/lib/tiff/moves";
import { filesNothing } from "@/lib/workboard/note-draft";
import type { NoteProposal, NoteStaff } from "@/lib/workboard/note-brain";
import { KEPT_AS_SAID, WHICH_JOB, earlierTurns } from "@/lib/workboard/note-turns";
import { askLine, lastTiff, planView, tiffSince } from "@/components/tiff/modal/plan-view";

/* TIFF DOING THINGS FROM THE PHONE (Isaac, 28 October 2026: "Chat ability =
   Tiff on the phone can do things (file notes, make tasks, book), not just
   answer"; and of the mock, "This is the same as how it works on the web
   now"). The web's conversation, decided in the same place and order
   (components/tiff/modal/use-conversation's `submit`, `route`, `read`,
   `reply`, `file`), on the web's own note router (actions/workboard-notes),
   which the phone route runs as the token's own person (lib/mobile/auth's
   actAsPhoneUser): every gate, capability and ServiceM8 press in it is
   theirs, as on the web.

     a note waiting on an answer   its answer: a reply, a job picked, or a
                                   visit's time
     a move, or a question         `ask`: the phone streams it from her
                                   answer route, as it does now
     anything else                 a new note: routed, asked about what she
                                   can't work out, and filed, with Undo

   A quick price is the web's alone: one asked for goes to her answer, and
   "price it or make it a task" is read as a task. Nothing here is the
   phone's own idea of what a note means. */

export type PhoneRow = { key: string; lead: string; join: string; text: string; needs: boolean };
export type PhoneOption = { label: string; target?: NoteTarget; visit?: { index: number; start: string | null } };

/** One of Tiff's turns, for the phone to draw. */
export type PhoneTurn =
  /** a question, or a move: stream it from her answer route */
  | { kind: "ask" }
  /** she needs an answer: what she has so far, and answers to tap */
  | { kind: "asks"; noteId: string; say: string; rows: PhoneRow[]; options: PhoneOption[]; answer: "reply" | "job" | "visit" }
  /** filed: what she made, its doors' words, and Undo */
  | { kind: "filed"; noteId: string; say: string; rows: PhoneRow[]; doors: string[]; visits: string[] }
  /** something to say and nothing to do: a refusal, or words kept as said */
  | { kind: "said"; say: string; failed: boolean };

export type SayInput =
  | { do: "say"; words: string; source: "voice" | "text"; before: { who: "you" | "tiff"; text: string }[]; target?: NoteTarget }
  | { do: "reply"; noteId: string; words: string }
  | { do: "job"; noteId: string; target: NoteTarget }
  | { do: "visit"; noteId: string; answer: string }
  | { do: "undo"; noteId: string }
  | { do: "away"; noteId: string };

const NOT_REACHED = "That didn't reach HeyTiff. Try again.";

const rowsOf = (proposal: NoteProposal, staff: NoteStaff[], asking: boolean): PhoneRow[] =>
  planView(proposal, staff, asking)
    .filter((r) => !r.off)
    .map((r) => ({ key: r.key, lead: r.lead, join: r.join, text: r.text, needs: r.needs }));

const optionsOf = (ask: FileAsk): PhoneOption[] => ask.options.map((o) => ({ label: o.label, ...(o.target ? { target: o.target } : {}), ...(o.visit ? { visit: o.visit } : {}) }));

/** A routed note: ask what is unclear, or file it now (use-conversation's `read`). */
async function read(r: Extract<RouteResult, { ok: true }>): Promise<PhoneTurn[]> {
  const c = r.proposal.clarify;
  /* "Which job?" is the one question a pick answers, and `fileNote` asks it
     with the jobs attached; every other question is a reply. */
  if (c && c.question !== WHICH_JOB) {
    return [{ kind: "asks", noteId: r.noteId, say: askLine(r.proposal.say, c.question), rows: rowsOf(r.proposal, r.staff, true), options: c.options.map((label) => ({ label })), answer: "reply" }];
  }
  return file(r.noteId, {}, r);
}

/** File it (use-conversation's `file`): what landed, and what's still asked. */
async function file(noteId: string, opts: { retarget?: NoteTarget }, routed?: Extract<RouteResult, { ok: true }>): Promise<PhoneTurn[]> {
  let res: FileResult;
  try {
    res = await fileNote(noteId, opts);
  } catch {
    return [{ kind: "said", say: NOT_REACHED, failed: true }];
  }
  if (res.ok) {
    const out: PhoneTurn[] = [
      {
        kind: "filed",
        noteId,
        say: lastTiff(res.turns) || "Done.",
        rows: routed ? rowsOf(routed.proposal, routed.staff, false) : [],
        doors: res.doors.map((d) => d.label),
        visits: (res.visits ?? []).map((v) => [v.line, v.aside].filter(Boolean).join(". ")),
      },
    ];
    /* a visit with no clear time is asked once the rest is filed */
    if (res.ask) out.push({ kind: "asks", noteId, say: res.ask.question, rows: [], options: optionsOf(res.ask), answer: "visit" });
    return out;
  }
  if (res.ask) {
    const job = res.ask.question === WHICH_JOB;
    return [{ kind: "asks", noteId, say: tiffSince(res.turns) || res.ask.question, rows: routed ? rowsOf(routed.proposal, routed.staff, true) : [], options: optionsOf(res.ask), answer: job ? "job" : "reply" }];
  }
  return [{ kind: "said", say: res.error, failed: true }];
}

/** Whether these words go to her answer rather than her router (use-conversation's `submit`). */
export function asksHer(words: string): boolean {
  if (parseMove(words)?.kind === "screen") return true;
  if (openName(words)) return true;
  if (looksLikeMove(words)) return true;
  if (priceIntent(words) === "price") return true;
  return looksLikeQuestion(words);
}

/** What Tiff does with what was said, or answered, on the phone. */
export async function tiffSays(input: SayInput): Promise<PhoneTurn[]> {
  if (input.do === "undo") {
    const r = await undoNote(input.noteId);
    return [{ kind: "said", say: r.ok ? lastTiff(r.turns) || "Taken back." : lastTiff(r.turns) || r.error, failed: !r.ok }];
  }
  if (input.do === "away") {
    await dismissNote(input.noteId).catch(() => null);
    return [];
  }
  if (input.do === "job") return file(input.noteId, { retarget: input.target });
  if (input.do === "visit") {
    const r = await answerVisit(input.noteId, input.answer);
    if (r.ok) {
      const out: PhoneTurn[] = [
        { kind: "filed", noteId: input.noteId, say: lastTiff(r.turns) || "Done.", rows: [], doors: [], visits: r.visit ? [[r.visit.line, r.visit.aside].filter(Boolean).join(". ")] : [] },
      ];
      if (r.ask) out.push({ kind: "asks", noteId: input.noteId, say: r.ask.question, rows: [], options: optionsOf(r.ask), answer: "visit" });
      return out;
    }
    if (r.ask) return [{ kind: "asks", noteId: input.noteId, say: tiffSince(r.turns) || r.ask.question, rows: [], options: optionsOf(r.ask), answer: "visit" }];
    return [{ kind: "said", say: r.error, failed: true }];
  }
  if (input.do === "reply") {
    let r: RouteResult;
    try {
      r = await continueNote(input.noteId, input.words);
    } catch {
      return [{ kind: "said", say: NOT_REACHED, failed: true }];
    }
    if (!r.ok) return [{ kind: "said", say: r.error, failed: true }];
    return read(r);
  }

  /* a new thing said */
  const words = input.words.trim();
  if (!words) return [];
  if (asksHer(words)) return [{ kind: "ask" }];
  const prior = earlierTurns(input.before.filter((t) => t.text.trim()));
  let r: RouteResult;
  try {
    r = await routeNote({ transcript: words, target: input.target ?? { kind: "none" }, source: input.source, ...(prior.length ? { before: prior } : {}) });
  } catch {
    /* words the server never got: filed as said, so nothing is lost */
    const k = await keepWords(words).catch(() => null);
    return [{ kind: "said", say: k?.ok ? KEPT_AS_SAID : NOT_REACHED, failed: !k?.ok }];
  }
  if (!r.ok) return [{ kind: "said", say: r.error, failed: !r.kept }];
  /* NOTHING TO FILE IS NOT A NOTE: set aside, and answered instead */
  if (filesNothing(r.proposal)) {
    await dismissNote(r.noteId).catch(() => null);
    return [{ kind: "ask" }];
  }
  return read(r);
}
