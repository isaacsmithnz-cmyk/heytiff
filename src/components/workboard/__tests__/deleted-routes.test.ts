import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* THE FLAT AGREEMENT LIST IS GONE, AND NOTHING MAY POINT AT IT AGAIN.

   `/dashboard/workboard/maintenance` was a page nothing in the app linked to —
   no rail row, no ⌘K entry, no link from the board — reachable only by typing
   the URL. The board's Agreements tab had superseded it: same agreements,
   grouped by category, searchable, with last-done / next / then columns, and
   opening into a sheet rather than a page. It even carried its own duplicate
   `NewAgreementModal`, a second copy of a component the board already had.

   The agreement's own page at `/maintenance/[id]` went with it. It looked at
   first like the only ServiceM8 job link/unlink in the app — which is why it
   was spared a round — but the projects board's TRIP SHEET has a reachable
   "ServiceM8 job" section calling the same `linkVisitJob` / `unlinkVisitJob`
   actions. Those actions are alive and tested; only the unreachable second
   entry point to them is gone, and the trip sheet is the pattern to copy when
   maintenance visits want one too.

   Deleting it left three live references behind: the detail screen's back
   link, and two `revalidatePath` calls that would have silently revalidated
   nothing. None of those would have failed a build or a render — a dead link
   just 404s when somebody finally clicks it. */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the deleted agreement routes", () => {
  it("has no route directory left behind", () => {
    const dir = join(SRC, "app/dashboard/workboard/maintenance");
    expect(existsSync(dir)).toBe(false);
  });

  it("is referenced by nothing — no bare path, no [id] path", () => {
    const bare = /\/dashboard\/workboard\/maintenance/;
    /* Comments stripped first: the files that explain WHY the list is gone
       necessarily name the path it used to live at, and a guard that counts
       its own explanation as a violation is a guard nobody can satisfy. */
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const offenders = walk(SRC)
      .filter((f) => bare.test(strip(readFileSync(f, "utf8"))))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
