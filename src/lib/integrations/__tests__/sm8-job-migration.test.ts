/* The new-job migration, read as text: what it lists and what it guards. */
import { readFileSync } from "fs";
import { join } from "path";
import { SM8_WRITE_KIND_SCOPES } from "../providers";

const SQL = readFileSync(join(process.cwd(), "docs/migrations/sm8_new_job_queue.sql"), "utf8");
const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES);
const listed = (re: RegExp) =>
  (SQL.match(re)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/'/g, ""))
    .filter(Boolean);

describe("the new-job migration", () => {
  it("lists exactly the code's five kinds in the kind check, the owner's switch and its function", () => {
    expect(KINDS).toEqual(["attachment", "note", "booking", "leave", "job"]);
    expect(listed(/sm8_writes_kind_check check \(kind in \(([^)]*)\)\)/)).toEqual(KINDS);
    expect(listed(/write_kinds <@ array\[([^\]]*)\]::text\[\]/)).toEqual(KINDS);
    expect(listed(/p_kind in \(([^)]*)\)/)).toEqual(KINDS);
  });

  it("adds its columns nullable, and holds every other kind's row to them being null", () => {
    for (const c of ["job_company_uuid", "job_company_new", "job_parent_uuid", "job_contact_uuid", "job_category_uuid", "job_draft", "job_done", "job_number"]) {
      expect(SQL).toMatch(new RegExp(`add column if not exists ${c}\\s+(text|jsonb|text\\[\\])`));
    }
    /* attachment, note, booking and leave each name the job columns null */
    expect(SQL.match(/and job_company_uuid is null and job_company_new is null/g)).toHaveLength(4);
  });

  it("lets a job row be a create only, under a client or site, with its words, a site naming its builder", () => {
    const branch = SQL.slice(SQL.indexOf("when kind = 'job' then"), SQL.indexOf("else false\n  end, false));"));
    expect(branch).toMatch(/op = 'create'/);
    expect(branch).toMatch(/job_company_uuid is not null/);
    expect(branch).toMatch(/\(job_company_new = 'site'\) = \(job_parent_uuid is not null\)/);
    expect(branch).toMatch(/job_draft \? 'address' and job_draft \? 'description'/);
    expect(branch).toMatch(/job_done <@ array\['company', 'job', 'contact'\]/);
  });

  it("is one transaction, applied before the deploy, and says never to run the leave file after it", () => {
    expect(SQL).toMatch(/^begin;$/m);
    expect(SQL).toMatch(/^commit;$/m);
    expect(SQL).toMatch(/WHEN TO APPLY: BEFORE THE DEPLOY/);
    expect(SQL).toMatch(/NEVER RE-RUN sm8_leave_queue\.sql/);
    expect(readFileSync(join(process.cwd(), "docs/migrations/sm8_leave_queue.sql"), "utf8")).toMatch(/AFTER sm8_new_job_queue\.sql, NEVER RE-RUN THIS ONE/);
  });
});
