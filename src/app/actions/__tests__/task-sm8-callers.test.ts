/**
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* CODE NEVER POSTS A DONE (two-way phase 2, PR C).

   A task's Done goes to ServiceM8 as whoever ticked, so it may only follow a
   PERSON'S tick on a screen made for ticking: the Tasks face, the day band,
   the bell and the Workboard's Urgent tab. `postDone: true` is how such a
   screen says so, and `takeBackDone: true` is how the two screens with a
   Reopen say it about the Undo. Read as source, because the danger is a new
   caller — a cron, a route, a reply that closes its task, a bulk action —
   that would post a Done nobody pressed for. */

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const all = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
/** Every call of `fn(`, with what follows it up to the closing paren of a
    one-line call (enough for the options object). */
const callsOf = (fn: string) =>
  all.flatMap((f) =>
    [...f.text.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)`, "g"))]
      .filter((m) => !/^\s*(taskId|id)\s*:\s*string/.test(m[1]))
      .map((m) => ({ path: f.path, args: m[1] }))
  );
const where = (calls: { path: string; args: string }[], flag: string) =>
  [...new Set(calls.filter((c) => new RegExp(`${flag}\\s*:\\s*true`).test(c.args)).map((c) => c.path))].sort();

it("has calls to read", () => {
  expect(callsOf("completeTask").length).toBeGreaterThan(4);
});

const onScreens = (calls: { path: string; args: string }[]) => calls.filter((c) => c.path.startsWith("components/"));

it("(F) exactly the four ticking screens post a Done, on every tick they make", () => {
  const ticks = callsOf("completeTask");
  expect(where(ticks, "postDone")).toEqual([
    "components/dashboard/home-day-band.tsx",
    "components/dashboard/home-tasks.tsx",
    "components/shell/bell.tsx",
    "components/workboard/board/urgent-tab.tsx",
  ]);
  // a screen's every tick is a person's: none of them leaves the flag off
  expect(onScreens(ticks).filter((c) => !/postDone\s*:\s*true/.test(c.args))).toEqual([]);
  // the bell's two (a reminder, and work somebody gave you) both
  expect(onScreens(ticks).filter((c) => c.path === "components/shell/bell.tsx")).toHaveLength(2);
});

it("(F) exactly the two screens with a Reopen take one back, on every Reopen they make", () => {
  const reopens = callsOf("reopenTask");
  expect(where(reopens, "takeBackDone")).toEqual([
    "components/dashboard/home-tasks.tsx",
    "components/workboard/board/urgent-tab.tsx",
  ]);
  expect(onScreens(reopens).filter((c) => !/takeBackDone\s*:\s*true/.test(c.args))).toEqual([]);
});

it("(F) nothing in the libraries or the API routes ticks a task, and a reply that closes its task posts no Done", () => {
  const offenders = callsOf("completeTask").filter((c) => c.path.startsWith("lib/") || c.path.startsWith("app/api/"));
  expect(offenders).toEqual([]);
  const byReply = callsOf("completeTask").filter((c) => c.path === "app/actions/job-note-sm8.ts");
  expect(byReply).toHaveLength(1);
  expect(byReply[0].args).not.toMatch(/postDone/);
});
