import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_KINDS } from "../files";

/* THE CHECK CONSTRAINT AND THE UNION MUST SAY THE SAME THING.

   `documents.kind` is the app's ownership guard — it is what stops an expense
   claim adopting a van's purchase invoice, or the company's public liability
   being filed onto a staff card. It is enforced twice: as a TypeScript union
   here, and as a CHECK constraint in Postgres.

   Adding a kind to one and not the other has already cost time — that is what
   docs/migrations/documents_kind_catchup.sql is, an entire migration written to
   put the constraint back in step after the code moved ahead of it. Uploading
   the new kind fails at the database with a constraint violation nobody can
   read, in production, on a screen that worked in every test.

   So: find the LAST migration that restates the constraint (each one drops and
   re-adds the whole list) and hold it against the union. */

function latestKindConstraint(): { file: string; kinds: string[] } {
  const dir = join(process.cwd(), "docs/migrations");
  const hits = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, sql: readFileSync(join(dir, f), "utf8") }))
    .filter((f) => f.sql.includes("documents_kind_check"))
    .map((f) => {
      // the last restatement in the file is the one that ends up applied
      const blocks = [...f.sql.matchAll(/kind = any \(array\[([\s\S]*?)\]\)/g)];
      const last = blocks[blocks.length - 1];
      return { file: f.file, kinds: [...(last?.[1] ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]) };
    })
    .filter((f) => f.kinds.length > 0);

  // the widest list wins: constraints are restated whole, so the newest
  // migration is the one that names every kind the ones before it did
  return hits.reduce((best, f) => (f.kinds.length > best.kinds.length ? f : best), hits[0]);
}

describe("documents.kind", () => {
  it("has a migration whose CHECK names exactly the kinds the code knows", () => {
    const { file, kinds } = latestKindConstraint();
    expect(file).toBeTruthy();
    expect([...kinds].sort()).toEqual([...DOCUMENT_KINDS].sort());
  });

  it("lists every kind exactly once in the union", () => {
    expect(new Set(DOCUMENT_KINDS).size).toBe(DOCUMENT_KINDS.length);
  });
});
