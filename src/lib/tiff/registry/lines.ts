/* WHAT TIFF SAYS AS SHE MOVES YOU — one line per destination.

   Built from where she's going, never from what she read, and only said when
   the round that moved you streamed no words of her own (her own line, in
   the language she was asked in, wins). "Opening Me." read wrong, so the
   screens people name by what's on them get their own words. */

const SCREEN_LINES: Readonly<Record<string, string>> = {
  Home: "Opening Home.",
  "Action required": "Opening Action required.",
  Noticeboard: "Opening the Noticeboard.",
  Workboard: "Opening the Workboard.",
  Toolbox: "Opening the Toolbox.",
  Design: "Opening the Studio.",
  Library: "Opening the Library.",
  "All documents": "Opening all your documents.",
  Me: "Opening your timesheet.",
  Timesheet: "Opening your timesheet.",
  Leave: "Opening your leave.",
  Expenses: "Opening your expenses.",
  Vehicle: "Opening your vehicle.",
  Notes: "Opening your notes.",
  Team: "Opening the Team screen.",
  "Time & Pay": "Opening Time & Pay.",
  Assets: "Opening Assets.",
  Admin: "Opening Admin.",
};

export const screenLine = (label: string) => SCREEN_LINES[label] ?? `Opening ${label}.`;

export const recordLine = (label: string) => `Opening ${label}.`;
