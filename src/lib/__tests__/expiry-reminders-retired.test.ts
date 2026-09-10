import fs from "node:fs";
import path from "node:path";

/* The per-card Remind me doors are gone (issue #640, piece 3). Their open task
   rows are closed by a migration, and the migration has one job and one
   test: `lead_days` is what every one of the five doors stamped and what a
   task Tiff made from a note never has — so it is the whole predicate. It
   must NOT drop the columns yet: the code running when it is applied still
   selects them, and a dropped column is a 500 until the deploy lands. */
const SQL = fs.readFileSync(path.join(process.cwd(), "docs/migrations/expiry_reminders_retired.sql"), "utf8");

describe("retiring the expiry reminders", () => {
  it("closes only OPEN rows that carry a lead — never a Tiff reminder, never history", () => {
    expect(SQL).toMatch(/delete from public\.tasks/);
    expect(SQL).toMatch(/status = 'open'/);
    expect(SQL).toMatch(/lead_days is not null/);
  });

  it("drops no column — the running code still reads them until the deploy lands", () => {
    expect(SQL).not.toMatch(/drop column/i);
  });
});
