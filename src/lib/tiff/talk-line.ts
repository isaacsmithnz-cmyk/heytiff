/* THE LINE OVER A TALK in the chat it was written into (the mock's board 4,
   "After: the talk is written down"): "Talk, 2:44 pm, 1 min", the time it
   began and how long it ran, rounded up to the minute and never under one.
   Drawn before the first turn of each run of turns that share a `talk`
   (lib/tiff/threads, TiffMsg.talk), the phone's chat and the web's alike. */

type Said = { at: number; talk?: number };

/** "Talk, 2:44 pm, 1 min". */
export function talkLine(start: number, lastAt: number, clock: (ms: number) => string): string {
  const mins = Math.max(1, Math.ceil((lastAt - start) / 60_000));
  return `Talk, ${clock(start)}, ${mins} min`;
}

/** For each turn, the line to draw before it, or null. */
export function talkLines(messages: readonly Said[], clock: (ms: number) => string): (string | null)[] {
  return messages.map((m, i) => {
    if (m.talk === undefined || messages[i - 1]?.talk === m.talk) return null;
    let last = i;
    while (messages[last + 1]?.talk === m.talk) last++;
    return talkLine(m.talk, messages[last].at, clock);
  });
}
