/**
 * @jest-environment node
 */

/* WHAT A BOOKING'S TWO PERMISSIONS COULD DO, AND WHAT HEYTIFF DOES WITH
   THEM (two-way phase 3; the spec's B-14), held by reading the source.

   manage_jobs can remove a job, and manage_schedule reaches job
   allocations, allocation windows and availability (F9, F10). HeyTiff does
   none of that: no source file sends a DELETE to a job, no booking request
   carries `active` (a booking is never restored by HeyTiff — putting one
   back is ServiceM8's deleted flag, which the plan bars), and nothing
   touches an allocation or a window. An availability is touched in ONE
   place, for ONE thing: leave approved in HeyTiff put on the person's day,
   and taken off when it is cancelled (sm8-write's three leave requests). */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The code without its comments: a comment that names a path isn't a use. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = sources(SRC).map((path) => ({ path, rel: relative(SRC, path), text: code(readFileSync(path, "utf8")) }));
const write = files.find((f) => f.rel === join("lib", "integrations", "sm8-write.ts"))!;

/** One exported function's source, up to the next export. */
function body(name: string): string {
  const at = write.text.indexOf(`export async function ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const next = write.text.indexOf("\nexport ", at + 1);
  return write.text.slice(at, next < 0 ? undefined : next);
}

describe("a booking's permissions reach further than HeyTiff goes (B-14)", () => {
  it("no source file sends a DELETE to a job: the only DELETEs are a booking's, a note's and leave's", () => {
    const deletes: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/`([a-z_]+)\/\$\{[^}]+\}\.json`\s*,\s*\{\s*method:\s*"DELETE"/g)) deletes.push(`${f.rel}: ${m[1]}`);
      /* a job's path and a DELETE in one statement, whatever its form */
      for (const stmt of f.text.split(";")) {
        if (/["'`/]job\/\$\{/.test(stmt) && /"DELETE"/.test(stmt)) deletes.push(`${f.rel}: job DELETE`);
      }
    }
    expect(deletes.sort()).toEqual([
      `${join("lib", "integrations", "sm8-write.ts")}: availability`,
      `${join("lib", "integrations", "sm8-write.ts")}: dbonote`,
      `${join("lib", "integrations", "sm8-write.ts")}: jobactivity`,
    ]);
  });

  it("no booking request's body names `active`, and a status change's names the status alone", () => {
    const booking = body("postSm8Booking");
    expect(booking).toMatch(/activity_was_scheduled: "1"/);
    expect(booking).not.toMatch(/\bactive\b/);
    expect(body("postSm8JobStatus")).toMatch(/json: \{ status \}/);
    expect(body("postSm8JobStatus")).not.toMatch(/\bactive\b/);
    expect(body("deleteSm8Booking")).not.toMatch(/json:/);
  });

  it("nothing touches a job allocation or an allocation window — no ServiceM8 path names one", () => {
    /* ServiceM8's endpoints are `<object>.json` and `<object>/<uuid>.json` */
    const endpoint = /(joballocation|allocationwindow)(\/[^"'`\s]*)?\.json/i;
    const touched = files.filter((f) => endpoint.test(f.text)).map((f) => f.rel);
    expect(touched).toEqual([]);
    /* ...and the pattern would see one */
    expect(endpoint.test("`joballocation/${uuid}.json`")).toBe(true);
  });

  it("an availability is written by leave's three requests alone, in sm8-write, and a leave body never names `active`", () => {
    const endpoint = /availabilit(?:y|ies)(\/[^"'`\s]*)?\.json/i;
    const touched = files.filter((f) => endpoint.test(f.text)).map((f) => f.rel);
    /* the one other place is the sync's object list (leave to ServiceM8,
       part two), which the read-only walk GETs into sm8_availability */
    expect(touched.sort()).toEqual([join("lib", "integrations", "sm8-sync-plan.ts"), join("lib", "integrations", "sm8-write.ts")].sort());
    const plan = files.find((f) => f.rel === join("lib", "integrations", "sm8-sync-plan.ts"))!;
    expect(plan.text.match(/availability\.json/g)).toEqual(["availability.json"]);
    expect(plan.text).toMatch(/endpoint: "availability\.json", table: "sm8_availability", scope: "read_schedule"/);
    const where = [...write.text.matchAll(/export async function (\w+)\(/g)]
      .map((m) => m[1])
      .filter((name) => endpoint.test(body(name)));
    expect(where.sort()).toEqual(["deleteSm8Availability", "postSm8Availability", "readSm8Availability"]);
    expect(body("postSm8Availability")).not.toMatch(/\bactive\b/);
    expect(body("deleteSm8Availability")).not.toMatch(/json:/);
  });
});
