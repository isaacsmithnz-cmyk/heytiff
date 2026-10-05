import { readFileSync } from "fs";
import { join } from "path";
import { SM8_WRITE_KIND_SCOPES } from "../providers";

/* Isaac, 2026-10-05: an accepted quote becomes the ServiceM8 work order */
const SQL = readFileSync(join(process.cwd(), "docs/migrations/sm8_quote_queue.sql"), "utf8");
const CUSTOMER = readFileSync(join(process.cwd(), "docs/migrations/sm8_customer_queue.sql"), "utf8");
const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES);
const listed = (re: RegExp) =>
  (SQL.match(re)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/'/g, ""))
    .filter(Boolean);

describe("the quote migration", () => {
  it("lists exactly the code's seven kinds in the kind check, the owner's switch and its function", () => {
    expect(KINDS).toEqual(["attachment", "note", "booking", "leave", "job", "customer", "quote"]);
    expect(listed(/sm8_writes_kind_check check \(kind in \(([^)]*)\)\)/)).toEqual(KINDS);
    expect(listed(/write_kinds <@ array\[([^\]]*)\]::text\[\]/)).toEqual(KINDS);
    expect(listed(/p_kind in \(([^)]*)\)/)).toEqual(KINDS);
  });

  it("keeps the customer file's rule for every other kind, word for word", () => {
    const rule = (sql: string) => sql.slice(sql.indexOf("add constraint sm8_writes_shape_check"), sql.indexOf("    when kind = 'customer' then"));
    expect(rule(SQL)).toBe(rule(CUSTOMER));
    expect(SQL).not.toMatch(/add column/);
  });

  it("lets a quote row update its job, add a line under its own uuid, or take a line off", () => {
    const branch = SQL.slice(SQL.indexOf("when kind = 'quote' then"), SQL.indexOf("    else false\n  end, false));"));
    expect(branch).toMatch(/cust_object in \('job', 'jobmaterial'\)/);
    expect(branch).toMatch(/and sm8_job_uuid is not null/);
    expect(branch).toMatch(/when op = 'update' then cust_object = 'job' and target_uuid = sm8_job_uuid/);
    expect(branch).toMatch(/when op = 'create' then cust_object = 'jobmaterial' and target_uuid is null/);
    expect(branch).toMatch(/when op = 'delete' then cust_object = 'jobmaterial' and target_uuid is not null/);
  });
});
