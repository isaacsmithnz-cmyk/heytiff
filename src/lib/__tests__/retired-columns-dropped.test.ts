import fs from "node:fs";
import path from "node:path";

/* Twelve columns nothing reads are dropped by
   docs/migrations/drop_retired_columns.sql.

   A DROPPED COLUMN THAT CODE STILL NAMES IS A 500, and nothing else in the
   tree would say so: a select list is a string, so tsc cannot see it, and the
   test fakes answer whatever they are asked. So this reads the source. It
   checks the five names that belong to nothing else — `vehicle_id`, `insurer`
   and the rest are live columns on other tables (documents, vehicles, the
   fleet's policies), and a plain text search for those would only ever cry
   wolf. */

const ROOT = process.cwd();
const SQL = fs.readFileSync(path.join(ROOT, "docs/migrations/drop_retired_columns.sql"), "utf8");

const DROPPED: [string, string[]][] = [
  ["organizations", ["arc_rta", "contractor_licence", "insurer", "insurance_policy", "insurance_expiry"]],
  ["staff_profiles", ["work_rights_doc_url"]],
  ["tasks", ["lead_days", "org_credential_id", "staff_licence_id", "work_rights_staff_id", "vehicle_id", "renewal_kind"]],
];

const UNAMBIGUOUS = ["arc_rta", "contractor_licence", "work_rights_doc_url", "lead_days", "renewal_kind"];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the retired columns", () => {
  it.each(DROPPED)("drops every one named on %s", (table, columns) => {
    const block = SQL.match(new RegExp(`alter table public\\.${table}\\b([^;]*);`))?.[1] ?? "";
    for (const column of columns) {
      expect(block).toMatch(new RegExp(`drop column if exists ${column}\\b`));
    }
  });

  it("is named nowhere in the app's own source", () => {
    const named = sourceFiles(path.join(ROOT, "src")).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return UNAMBIGUOUS.filter((column) => new RegExp(`\\b${column}\\b`).test(text)).map(
        (column) => `${path.relative(ROOT, file)}: ${column}`,
      );
    });
    expect(named).toEqual([]);
  });
});
