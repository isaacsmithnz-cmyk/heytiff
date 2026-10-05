import { readFileSync } from "fs";
import { join } from "path";
import { SM8_WRITE_KIND_SCOPES } from "../providers";

const SQL = readFileSync(join(process.cwd(), "docs/migrations/sm8_customer_queue.sql"), "utf8");
const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES).filter((k) => k !== "quote");
const listed = (re: RegExp) =>
  (SQL.match(re)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/'/g, ""))
    .filter(Boolean);

describe("the customer migration", () => {
  it("lists exactly the code's six kinds in the kind check, the owner's switch and its function", () => {
    expect(KINDS).toEqual(["attachment", "note", "booking", "leave", "job", "customer"]);
    expect(listed(/sm8_writes_kind_check check \(kind in \(([^)]*)\)\)/)).toEqual(KINDS);
    expect(listed(/write_kinds <@ array\[([^\]]*)\]::text\[\]/)).toEqual(KINDS);
    expect(listed(/p_kind in \(([^)]*)\)/)).toEqual(KINDS);
  });

  it("holds every other kind's row to its two columns being null", () => {
    expect(SQL.match(/and cust_object is null and cust_fields is null/g)).toHaveLength(5);
  });

  it("lets a customer row add a contact to a job, change a record, or remove a contact", () => {
    const branch = SQL.slice(SQL.indexOf("when kind = 'customer' then"), SQL.indexOf("else false\n  end, false));"));
    expect(branch).toMatch(/cust_object in \('jobcontact', 'company', 'job'\)/);
    expect(branch).toMatch(/when op = 'create' then cust_object = 'jobcontact' and sm8_job_uuid is not null/);
    expect(branch).toMatch(/when op = 'delete' then cust_object = 'jobcontact' and target_uuid is not null/);
  });
});
