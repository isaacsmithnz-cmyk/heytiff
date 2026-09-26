import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLIED_GROUPS, describeApplied } from "../journal";

/* THE TWO LISTS THAT CAN DRIFT, PINNED AGAINST EACH OTHER BY READING THE
   SOURCE.

   `applied` is written in `actions/workboard-notes.ts` and read in
   `lib/dashboard/journal.ts`, and the wording is deliberately copied rather
   than shared: the write side counts each group into its "Saved — 2 tasks,
   1 flag." summary as it inserts it, and unpicking that to share a table
   would be a bigger change than the drift it prevents.

   So the guard reads the write side instead of restating it. A hand-written
   list of the keys would have to be edited by the same person who broke it,
   which is exactly the guard that doesn't bite. This one fails if a group is
   added, renamed, reworded or dropped on either side. It is deliberately
   ignorant of HOW a key is written — both shapes below are scanned — because
   a new ending that files its own payload is the specific thing that went
   unnoticed last time.

   Comments are stripped first. Two source-scanning guards in this repo have
   passed vacuously by matching their own explanatory prose, and the prose in
   `workboard-notes.ts` names these keys out loud. */

const SOURCE = join(__dirname, "..", "..", "..", "app", "actions", "workboard-notes.ts");
const RECORD_SQL = join(__dirname, "..", "..", "..", "..", "docs", "migrations", "tiff_modal_record.sql");

const code = readFileSync(SOURCE, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

/* THE TWO KEYS THE JOURNAL READS THAT THIS FILE DOES NOT WRITE, each with
   where it does come from. Held both ways below: one that starts being
   written here again, or that the journal stops reading, fails.

     kbIds      "Add to the Library" (`publishNoteKb`) appends it in the
                database, one statement (tiff_modal_record.sql), so a press
                that lands while the note files keeps both.
     noteLines  Only rows from before carry it: the old capture card's "keep
                it for me" and the Debrief's leftovers wrote it, and both
                went (2026-09-27, 2026-09-25). Their doors still open. */
const ELSEWHERE = ["kbIds", "noteLines"];

/** Every `record("key", ids, "one"[, "many"])` in `applyConfirmed` — the
    groups a filed proposal can create, each carrying its own count wording. */
function recorded(): Map<string, [one: string, many: string]> {
  const found = new Map<string, [string, string]>();
  for (const m of code.matchAll(/\brecord\(\s*"([A-Za-z]+)"\s*,([\s\S]*?)\)\s*;/g)) {
    const words = [...m[2].matchAll(/"([^"]*)"/g)].map((w) => w[1]);
    /* One word or two. Three would mean the ids expression grew a string
       literal and this scan is reading the wrong argument — fail rather than
       guess which one is the plural. */
    expect(words.length === 1 || words.length === 2).toBe(true);
    found.set(m[1], [words[0], words[1] ?? `${words[0]}s`]);
  }
  return found;
}

/** Every `applied: { key: … }` written straight onto the row — an ending
    that never went through the writer at all. There is none today; a new
    one that files its own payload is the thing that went unnoticed once. */
function literals(): string[] {
  return [...code.matchAll(/applied:\s*\{\s*([A-Za-z]+)\s*:/g)].map((m) => m[1]);
}

describe("the journal's vocabulary against the write side", () => {
  it("counts every recorded group in the write side's own words", () => {
    const groups = new Map(APPLIED_GROUPS.map(([key, one, many]) => [key, [one, many]]));
    const found = recorded();
    expect(found.size).toBeGreaterThan(0);

    for (const [key, [one, many]] of found) {
      expect(groups.get(key)).toEqual([one, many]);
      // and the wording is reachable: this is the sentence a chip renders
      expect(describeApplied({ [key]: ["a"] })[0].text).toBe(`1 ${one}`);
      expect(describeApplied({ [key]: ["a", "b"] })[0].text).toBe(`2 ${many}`);
    }
  });

  it("knows every key the write side files, however it files it", () => {
    /* THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG FROM THE OTHER END: a
       key written onto the row by an ending of its own is still a key the
       journal has to be able to read, and it never passes through `record`. */
    const written = new Set([...recorded().keys(), ...literals()]);
    for (const key of ELSEWHERE) expect(written.has(key)).toBe(false);
    expect(new Set([...written, ...ELSEWHERE])).toEqual(new Set(APPLIED_GROUPS.map(([key]) => key)));
  });

  it("finds the Library's key where it is written", () => {
    expect(code).toContain('"workboard_note_add_kb"');
    expect(readFileSync(RECORD_SQL, "utf8")).toMatch(/'kbIds'/);
  });

  it("still describes the words kept as said by name", () => {
    /* Belt and braces on the set comparison above: it is symmetric, so both
       sides going missing together would pass it. These two are the
       endings the journal was once blind to, and they are worth naming out
       loud: a note filed on a ServiceM8 job keeps its words on the job
       (`jobNotes`), and a kept line from before still reads. */
    expect(recorded().has("jobNotes")).toBe(true);
    expect(describeApplied({ jobNotes: ["gate code is 4821"] })).toEqual([
      { kind: "kept", text: "1 note on the job" },
    ]);
    expect(describeApplied({ noteLines: ["chase the coil pricing"] })).toEqual([
      { kind: "kept", text: "1 line kept" },
    ]);
  });
});
