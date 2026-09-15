/* The open issues, with their targets named. Two things can go wrong here:
   naming targets one query per row (fifty issues would be fifty round trips
   to paint a list), and inventing a place for a target that has gone. */

type Call = { table: string; columns?: string; eq: Record<string, unknown>; in?: [string, string[]] };

let rows: Record<string, Record<string, unknown>[]> = {};
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.columns = cols;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    call.eq[col] = val;
    return chain;
  };
  chain.in = (col: string, vals: string[]) => {
    call.in = [col, vals];
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.then = (res: (v: { data: unknown }) => unknown) => {
    /* Answer only the ids asked for, the way the database would. */
    let data = rows[name] ?? [];
    if (call.in) {
      const [col, vals] = call.in;
      data = data.filter((r) => vals.includes(String(r[col])));
    }
    return Promise.resolve({ data }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { listOpenIssues } from "../issues-query";

const issue = (id: string, kind: string, target: string | null, over: Record<string, unknown> = {}) => ({
  id,
  summary: `issue ${id}`,
  equipment_ref: null,
  occurrences: 1,
  first_seen: "2026-09-01",
  last_seen: "2026-09-14",
  target_kind: kind,
  target_id: target,
  ...over,
});

beforeEach(() => {
  rows = {};
  calls.length = 0;
});

const of = (t: string) => calls.filter((c) => c.table === t);

it("reads the open issues of the org and nothing else", async () => {
  rows.workboard_issues = [issue("i1", "none", null)];
  const out = await listOpenIssues("org-1");
  expect(of("workboard_issues")).toHaveLength(1);
  expect(of("workboard_issues")[0].eq).toEqual({ org_id: "org-1", resolved: false });
  expect(out).toEqual([
    {
      id: "i1",
      summary: "issue i1",
      equipmentRef: null,
      occurrences: 1,
      firstSeen: "2026-09-01",
      lastSeen: "2026-09-14",
      targetKind: "none",
      targetId: null,
      where: null,
    },
  ]);
});

it("names every kind of target, one read per table, not one per row", async () => {
  rows.workboard_issues = [
    issue("i1", "visit", "v1"),
    issue("i2", "visit", "v2"),
    issue("i3", "agreement", "a2"),
    issue("i4", "project", "p1"),
    issue("i5", "job", "j1"),
  ];
  rows.maintenance_visits = [
    { id: "v1", agreement_id: "a1", job_number: "1042", job_no: null },
    { id: "v2", agreement_id: "a1", job_number: null, job_no: 1007 },
  ];
  rows.maintenance_agreements = [
    { id: "a1", label: "Quarterly service", client_name: "Bayview Apartments" },
    { id: "a2", label: "Annual clean", client_name: "Northgate Realty" },
  ];
  rows.projects = [{ id: "p1", name: "Fit-out", client_name: "Harbour St" }];
  rows.sm8_jobs = [{ uuid: "j1", generated_job_id: "3271", company_uuid: "c1" }];
  rows.sm8_companies = [{ uuid: "c1", name: "Richard Ferns" }];

  const out = await listOpenIssues("org-1");
  expect(out.map((i) => [i.id, i.where])).toEqual([
    ["i1", "Job 1042, Bayview Apartments"],
    ["i2", "Job 1007, Bayview Apartments"],
    ["i3", "Northgate Realty, Annual clean"],
    ["i4", "Harbour St, Fit-out"],
    ["i5", "Job 3271, Richard Ferns"],
  ]);
  for (const t of ["maintenance_visits", "maintenance_agreements", "projects", "sm8_jobs", "sm8_companies"]) {
    expect(of(t)).toHaveLength(1);
    expect(of(t)[0].eq.org_id).toBe("org-1");
  }
  // the visits' agreements were asked for alongside the agreement the issue named
  expect(of("maintenance_agreements")[0].in![1].sort()).toEqual(["a1", "a2"]);
});

it("leaves a target that has gone without a place, rather than inventing one", async () => {
  rows.workboard_issues = [issue("i1", "project", "gone"), issue("i2", "visit", "v-gone")];
  rows.projects = [];
  rows.maintenance_visits = [];
  const out = await listOpenIssues("org-1");
  expect(out.map((i) => i.where)).toEqual([null, null]);
  // and asked nothing of the tables it had no ids for
  expect(of("sm8_jobs")).toHaveLength(0);
  expect(of("maintenance_agreements")).toHaveLength(0);
});

it("asks nothing further when there are no issues", async () => {
  rows.workboard_issues = [];
  expect(await listOpenIssues("org-1")).toEqual([]);
  expect(calls).toHaveLength(1);
});

it("keeps a count honest — never below one", async () => {
  rows.workboard_issues = [issue("i1", "none", null, { occurrences: 0 })];
  expect((await listOpenIssues("org-1"))[0].occurrences).toBe(1);
});
