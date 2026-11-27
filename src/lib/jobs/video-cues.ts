/* A JOB VIDEO'S CAPTIONS, from the words Scribe heard and when (Isaac, 27
   November 2026: "Why don't we have the captions and shit on the video? I
   thought we built that whole thing", of the 10 November mock
   https://claude.ai/artifact/5KE1kqVyM3qgxPX9kEm5nr, "Maybe captions get
   added to the video"). Pure: the server makes them once, the phone shows
   the one under the playhead.

   A caption is a short line, never a paragraph over the picture: a new one
   starts after a sentence ends, at a pause, past seven words or past three
   and a bit seconds, as a broadcast caption breaks. */

export type TimedWord = { text: string; start: number; end: number };
export type Cue = { start: number; end: number; text: string };

/** What sits next to the video in storage: what was said, whole, and its captions. */
export type VideoWords = { v: 1; text: string; cues: Cue[] };

const MOST_WORDS = 7;
const MOST_SECONDS = 3.2;
const PAUSE_SECONDS = 0.8;

export function cuesOf(words: readonly TimedWord[]): Cue[] {
  const cues: Cue[] = [];
  let line: TimedWord[] = [];
  const close = () => {
    if (!line.length) return;
    cues.push({ start: line[0]!.start, end: line[line.length - 1]!.end, text: line.map((w) => w.text.trim()).join(" ").replace(/\s+([,.?!;:])/g, "$1") });
    line = [];
  };
  for (const w of words) {
    if (!w.text.trim()) continue;
    const last = line[line.length - 1];
    if (
      last &&
      (/[.?!…]["'”’)]*$/.test(last.text) ||
        w.start - last.end > PAUSE_SECONDS ||
        line.length >= MOST_WORDS ||
        w.end - line[0]!.start > MOST_SECONDS)
    )
      close();
    line.push(w);
  }
  close();
  return cues;
}

/** The caption at `seconds`, or null between lines. */
export function cueAt(cues: readonly Cue[], seconds: number): Cue | null {
  return cues.find((c) => seconds >= c.start && seconds <= c.end + 0.3) ?? null;
}

/** Where a video's words are kept: beside the video, as text the bucket takes. */
export const wordsRefOf = (videoRef: string) => `${videoRef}.words.txt`;

/** The words file as read back, or null when it isn't one. */
export function parseVideoWords(raw: string): VideoWords | null {
  try {
    const o = JSON.parse(raw) as Partial<VideoWords>;
    if (o?.v !== 1 || typeof o.text !== "string" || !Array.isArray(o.cues)) return null;
    const cues = o.cues.filter(
      (c): c is Cue => !!c && typeof c.start === "number" && typeof c.end === "number" && typeof c.text === "string"
    );
    return { v: 1, text: o.text, cues };
  } catch {
    return null;
  }
}
