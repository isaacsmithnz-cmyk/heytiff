/* THE WORDS AS YOU SPEAK, one by one, each with a name it keeps while it
   stays. The live model sends its best guess every moment, and a later guess
   fixes an earlier word ("the boat" becomes "the quote"). Matching the new
   guess against the last one tells which words stayed (they keep their name,
   so they sit still), which went, and which are new. A new word where an old
   one went is a fix, one for one, and glides in where the old one stood
   rather than swapping its letters under your eye (Isaac, 5 November 2026:
   "instead of like a jumpy change, it's like morphing into the correct
   word"; then "line them up", web and phone the same). The phone's copy is
   heytiff-mobile src/lib/morphWords.ts. */

export type Said = { id: number; w: string; fix: boolean };

/* past this many pairs to weigh, the middle is taken as all new */
const MOST_PAIRS = 40000;

/** For each word in `b`, the place in `a` of the same word kept from it, or -1:
    the same start, the same end, then the longest run the middles share. */
export function keptFrom(a: string[], b: string[]): number[] {
  const map = Array<number>(b.length).fill(-1);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) {
    map[s] = s;
    s++;
  }
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
    map[eb] = ea;
  }
  const A = a.slice(s, ea);
  const B = b.slice(s, eb);
  if (!A.length || !B.length || A.length * B.length > MOST_PAIRS) return map;
  const L = Array.from({ length: A.length + 1 }, () =>
    Array<number>(B.length + 1).fill(0),
  );
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      L[i]![j] =
        A[i] === B[j]
          ? L[i + 1]![j + 1]! + 1
          : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      map[s + j] = s + i;
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return map;
}

/** The words of `text`, named against the words shown before: kept ones keep theirs, new ones take the next from `next`. */
export function morphWords(
  was: Said[],
  text: string,
  next: number,
): { words: Said[]; next: number } {
  const words = text.split(/\s+/).filter(Boolean);
  const map = keptFrom(
    was.map((s) => s.w),
    words,
  );
  const kept = new Set(map.filter((i) => i >= 0));
  /* between two kept words, as many new words as old ones went are fixes */
  const fixed = Array<boolean>(words.length).fill(false);
  let lastOld = -1;
  let gapStart = 0;
  for (let j = 0; j <= words.length; j++) {
    if (j < words.length && map[j]! < 0) continue;
    const upTo = j === words.length ? was.length : map[j]!;
    let gone = 0;
    for (let i = lastOld + 1; i < upTo; i++) if (!kept.has(i)) gone++;
    for (let t = gapStart; t < j && gone > 0; t++, gone--) fixed[t] = true;
    if (j < words.length) lastOld = map[j]!;
    gapStart = j + 1;
  }
  let n = next;
  return {
    words: words.map((w, j) =>
      map[j]! >= 0 ? was[map[j]!]! : { id: n++, w, fix: fixed[j]! },
    ),
    next: n,
  };
}
