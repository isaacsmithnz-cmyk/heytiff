/* A NOTE IS A CONVERSATION — the turns, pure.

   The Tiff modal (the new Home's, behind HOME_DESK) talks rather than showing
   a review card: you say it, Tiff answers with what she will file and asks
   what she cannot work out, you reply, and she files the moment nothing is
   left to ask. `workboard_notes.turns` (docs/migrations/tiff_modal_turns.sql)
   is that exchange, in order, and Tiff's last turn is the line the diary
   shows under the words.

   PURE AND SHARED. The server appends and caps; the modal renders; neither
   restates the shape. Nothing here reads a clock it was not handed except
   `turn`'s default, which only the server calls. */

/** Where the words were said: the modal's room or the entry box's. A sheet's
    Tiff button has no room; its note has a target instead. */
export const TIFF_ROOMS = ["home", "diary", "tasks", "calendar"] as const;
export type TiffRoom = (typeof TIFF_ROOMS)[number];

export const isTiffRoom = (v: unknown): v is TiffRoom =>
  (TIFF_ROOMS as readonly unknown[]).includes(v);

export type TurnWho = "you" | "tiff";

export type Turn = {
  who: TurnWho;
  text: string;
  /** ISO instant. */
  at: string;
  /** Only on the first "you" turn: the room the words were said in, so a
      reply routes the whole note again with the same hint. */
  room?: TiffRoom;
};

/** The database's own ceiling (`workboard_notes_turns_array`). Six replies
    make fourteen turns, and Done and Undo two more, so this is a backstop
    rather than a limit anyone meets. */
export const TURNS_MAX = 40;

/** How many times a person may answer Tiff on one note. Every reply is an
    Opus call over the whole note, and a seventh round is a note that should
    have been two. */
export const REPLIES_MAX = 6;

/** One turn's words. The transcript itself is capped at 8,000 where it is
    stored; a turn is never longer than what it repeats. */
export const TURN_TEXT_MAX = 8000;

export function turn(who: TurnWho, text: string, at: string = new Date().toISOString()): Turn {
  return { who, text: text.trim().slice(0, TURN_TEXT_MAX), at };
}

/** What the column holds, shaped. A row written before the column existed
    reads `[]` (the column's default), and anything that is not a turn we
    wrote is dropped rather than rendered. */
export function turnsOf(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const t of raw) {
    const row = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (row.who !== "you" && row.who !== "tiff") continue;
    const text = typeof row.text === "string" ? row.text.trim().slice(0, TURN_TEXT_MAX) : "";
    if (!text) continue;
    const at = typeof row.at === "string" ? row.at : "";
    out.push(isTiffRoom(row.room) ? { who: row.who, text, at, room: row.room } : { who: row.who, text, at });
  }
  return out;
}

/** Append, keeping the note itself (the first turn) and the newest of the
    rest when the ceiling would be passed. An empty turn is not appended. */
export function withTurns(turns: readonly Turn[], ...more: Turn[]): Turn[] {
  const all = [...turns, ...more.filter((t) => t.text.trim() !== "")];
  if (all.length <= TURNS_MAX) return all;
  return [all[0], ...all.slice(all.length - (TURNS_MAX - 1))];
}

/** Replies so far: every "you" turn after the first, which is the note. */
export function repliesIn(turns: readonly Turn[]): number {
  return Math.max(0, turns.filter((t) => t.who === "you").length - 1);
}

/** The room the note was first said in, if it said. */
export const roomOf = (turns: readonly Turn[]): TiffRoom | undefined =>
  turns.find((t) => t.who === "you")?.room;
