/**
 * @jest-environment node
 */

/* Every sentence a booking says (two-way phase 3, PR A): the house's rules
   for words (law 12, law 20, law 21), every placeholder one a caller fills,
   the two copies of WRITE_WORDS equal to what they copy, a module with no
   import (so sm8-write-plan and providers can take its words without a
   cycle), and every key used — by this PR, or named below for the PR that
   will use it. The files-only and files-and-notes sentences stay main's
   (A-9, A-15). */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BOOKING_WORDS } from "../sm8-booking-words";
import { reasonOf } from "../sm8-booking-plan";
import { kindCount, sendRefusal, WRITE_WORDS, type Sm8WriteState } from "../sm8-write-plan";

const ROOT = process.cwd();
const words = BOOKING_WORDS as unknown as Record<string, Record<string, string>>;
const all = Object.entries(words).flatMap(([group, keys]) => Object.entries(keys).map(([key, text]) => ({ path: `${group}.${key}`, group, key, text })));

describe("the booking words", () => {
  it("(F) import nothing, so the plan, the write plan and providers can all take them without a cycle", () => {
    /* the statements, comments out */
    const src = readFileSync(join(ROOT, "src/lib/integrations/sm8-booking-words.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{)[^;]*\bfrom\b/m);
  });

  it("carry no middot, no arrow, no exclamation mark and no 'successfully'", () => {
    for (const { path, text } of all) {
      expect([path, /[·→!]|successfully/i.test(text)]).toEqual([path, false]);
    }
  });

  it("use only the placeholders their callers fill", () => {
    const allowed = new Set(["name", "day", "start", "end", "number", "status", "n", "list", "place", "why", "reason", "a", "b", "c"]);
    for (const { path, text } of all) {
      for (const m of text.matchAll(/\{(\w+)\}/g)) expect([path, allowed.has(m[1])]).toEqual([path, true]);
    }
    // kindWords' list is its own: nothing else says {a}, {b} or {c}
    for (const { path, group, text } of all) if (group !== "kindWords") expect([path, /\{[abc]\}/.test(text)]).toEqual([path, false]);
  });

  it("copy WRITE_WORDS' two sentences exactly, and reuse the Workboard's own and the Schedule's", () => {
    expect(BOOKING_WORDS.press.capped).toBe(WRITE_WORDS.paused);
    expect(BOOKING_WORDS.press.unreadable).toBe(WRITE_WORDS.settingsUnread);
    expect(readFileSync(join(ROOT, "src/app/actions/workboard.ts"), "utf8")).toContain(`"${BOOKING_WORDS.press.noManage}"`);
    // the Schedule marks a leftover in these words; the line says them as a sentence
    expect(readFileSync(join(ROOT, "src/lib/workboard/focus.ts"), "utf8")).toContain(
      `"${BOOKING_WORDS.line.leftover.replace(/\.$/, "")}"`
    );
  });

  it("(F) are the booking engine's only words: its sender, queue, overlay and zone say no sentence, name or status of their own (review S5)", () => {
    const fills = new Set<string>(Object.values(BOOKING_WORDS.fill));
    for (const file of [
      "src/lib/integrations/sm8-booking-send.ts",
      "src/app/actions/sm8-booking-queue.ts",
      "src/lib/integrations/sm8-booking-overlay.ts",
      "src/lib/integrations/sm8-booking-zone.ts",
    ]) {
      const src = readFileSync(join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const own = [...src.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((t) => /^[A-Z][a-z]+ [a-z]/.test(t) || fills.has(t));
      expect([file, own]).toEqual([file, []]);
    }
  });

  it("say manage_schedule's whole reach: allocations, booking windows and availability", () => {
    expect(BOOKING_WORDS.scope.schedule).toMatch(/job allocations, booking windows and availability/);
    expect(BOOKING_WORDS.scope.schedule).toMatch(/never touches allocations, booking windows or availability/);
    expect(BOOKING_WORDS.scope.jobs).toMatch(/It never removes a job\.$/);
  });
});

/* EVERY KEY IS USED. A key is used when some source file outside the tests
   names it (BOOKING_WORDS.<group>.<key>), or — for a row's reason — when
   reasonOf recognises it, which is how a line reads every stored reason.
   What isn't used yet is named here for the PR that uses it, and the list
   is EXACT: a PR that starts using one takes it off, and nothing is added
   (a ratchet, as docs/design.md's are). */
const LATER: Record<string, string[]> = {
  // B and C use every refusal they were given (the actions, app/actions/
  // booking-sm8, say each press.* line), so neither has a list left
  // D: the Book in panel, a leftover on the Visits face and its confirm's doors
  D: [
    ...Object.keys(BOOKING_WORDS.panel).map((k) => `panel.${k}`),
    "line.leftover",
    "line.leftoverUnsuccessful",
    "door.clearBooking",
    "door.keep",
  ],
  // E: Home's alert and verb, the bell, and the owner's guard chip
  E: [
    ...Object.keys(BOOKING_WORDS.home).map((k) => `home.${k}`),
    ...Object.keys(BOOKING_WORDS.bell).map((k) => `bell.${k}`),
    "door.clear",
    "card.guardChip",
  ],
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") sources(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith("sm8-booking-words.ts")) out.push(p);
  }
  return out;
}

describe("every booking word", () => {
  it("(F) is used, or waits for the PR named for it — and the list only shrinks", () => {
    const named = new Set<string>();
    for (const file of sources(join(ROOT, "src"))) {
      for (const m of readFileSync(file, "utf8").matchAll(/BOOKING_WORDS\.(\w+)\.(\w+)/g)) named.add(`${m[1]}.${m[2]}`);
    }
    const used = (p: { path: string; group: string; key: string; text: string }) =>
      named.has(p.path) || (p.group === "row" && reasonOf(p.text) === p.key);
    const unused = all.filter((p) => !used(p)).map((p) => p.path).sort();
    expect(unused).toEqual(Object.values(LATER).flat().sort());
  });
});

/* THE FILES-ONLY AND FILES-AND-NOTES WORDS ARE MAIN'S. */
describe("the words that were there before bookings", () => {
  const state = (over: Partial<Sm8WriteState> = {}): Sm8WriteState => ({
    readable: true,
    kinds: ["attachment", "note"],
    deployment: true,
    mode: "live",
    modeStored: "live",
    pausedReason: null,
    pausedAt: null,
    linked: true,
    connected: true,
    tenantId: "v1",
    granted: ["attachment", "note"],
    refused: [],
    timezoneName: null,
    ownerKinds: ["attachment", "note"],
    ownerKindsRead: true,
    ...over,
  });

  it("(F) count files, and files and notes, word for word, with no bookings or bookings at 0", () => {
    for (const booking of [undefined, 0]) {
      expect(kindCount({ attachment: 1, note: 0, booking })).toBe("1 file");
      expect(kindCount({ attachment: 3, note: 0, booking })).toBe("3 files");
      expect(kindCount({ attachment: 0, note: 1, booking })).toBe("1 note");
      expect(kindCount({ attachment: 1, note: 2, booking })).toBe("1 file and 2 notes");
      expect(kindCount({ attachment: 0, note: 0, booking })).toBe("0 files");
    }
  });

  it("refuse a file's press and a note's in their own words, as before", () => {
    expect(sendRefusal(state({ ownerKinds: ["note"] }), "attachment")).toBe(
      "Sending files to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8."
    );
    expect(sendRefusal(state({ granted: ["note"] }), "attachment")).toBe(
      "ServiceM8 hasn't given HeyTiff permission to add files yet. An owner can change that in Integrations, ServiceM8."
    );
    expect(sendRefusal(state({ ownerKinds: ["attachment"] }), "note")).toBe(
      "Sending notes to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8."
    );
  });
});
