import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ADMIN_SECTIONS } from "../admin-sections";
import { SELF_EDITABLE_SECTIONS } from "../profile";

/* THE COLUMN NOBODY WRITES.

   `staff_profiles.work_rights_verified_at` exists in the schema and no code
   path has ever set it. Both compliance readers — the Team directory's chip
   (lib/staff/derive) and the dashboard's work-rights chip
   (lib/dashboard/chips) — used to read it, while both write paths saved
   `vevo_checked_at`. The result was a warning nobody could clear: you recorded
   the VEVO check on the profile, the date appeared on the card, and "Work
   rights unverified" stayed on Home, in the topbar bell count and in the Team
   directory for good. Prod bore it out — of the staff with a status recorded,
   `work_rights_verified_at` was set on none of them.

   Nothing else can catch this. Both columns exist, both are `date`, and
   reading the wrong one is valid TypeScript that returns null forever — which
   looks exactly like "not verified yet".

   So: the phantom column may not be READ, and the column that is read has to
   be one the forms actually save. The scan strips comments first, because the
   explanation you are reading names the column and a guard that matches its
   own prose passes vacuously. */

const SRC = join(__dirname, "..", "..", "..");
const PHANTOM = "work_rights_verified_at";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      sources(path, out);
    } else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Source with block and line comments removed — and string literals kept, since
    a column name reaches Supabase as a string. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the work-rights check date", () => {
  it("is never read from the column no write path sets", () => {
    const offenders = sources(SRC)
      .filter((f) => code(readFileSync(f, "utf8")).includes(PHANTOM))
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("is `vevo_checked_at` on both write paths — the column the readers read", () => {
    // If either of these ever moves, the readers have to move with it.
    expect(SELF_EDITABLE_SECTIONS.workrights).toContain("vevo_checked_at");
    expect(ADMIN_SECTIONS.workrights.columns).toContain("vevo_checked_at");
  });
});
