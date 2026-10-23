/* WHAT TIFF SAYS AS SHE MOVES YOU — one line per destination.

   Built from where she's going, never from what she read, and only said when
   the round that moved you streamed no words of her own (her own line, in
   the language she was asked in, wins). "Opening Me." read wrong, so the
   screens people name by what's on them get their own words. */

const SCREEN_LINES: Readonly<Record<string, string>> = {
  Home: "Opening Home.",
  Conversations: "Opening Conversations.",
  "My notes": "Opening your notes.",
  Jobs: "Opening Jobs.",
  Schedule: "Opening the Schedule.",
  Documents: "Opening Documents.",
  Library: "Opening the Library.",
  Design: "Opening Design.",
  Team: "Opening Team.",
  Notices: "Opening the notices.",
  "Your card": "Opening your card.",
  Timesheet: "Opening your timesheet.",
  Leave: "Opening your leave.",
  "Expense claims": "Opening your expense claims.",
  Reports: "Opening Reports.",
  Settings: "Opening Settings.",
};

export const screenLine = (label: string) => SCREEN_LINES[label] ?? `Opening ${label}.`;

export const recordLine = (label: string) => `Opening ${label}.`;
