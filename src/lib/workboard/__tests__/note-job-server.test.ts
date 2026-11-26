/**
 * @jest-environment node
 */

/* THE JOBS A WORK NAMES, read from the mirror (note-job-server). The
   database is a fake that runs the filters the finder asks for, so these
   pin what is looked for: open jobs only, every word of the work in the
   description. Made-up jobs. */
type Row = Record<string, unknown>;
let jobs: Row[] = [];
const companies: Row[] = [{ uuid: "c-1", org_id: "org-1", name: "Sampleco Building", parent_company_uuid: null }];

function from(table: string) {
  const rows = () => (table === "sm8_jobs" ? jobs : companies);
  const tests: ((r: Row) => boolean)[] = [];
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => (tests.push((r) => r[c] === v), b);
  b.in = (c: string, v: unknown[]) => (tests.push((r) => v.includes(r[c])), b);
  b.ilike = (c: string, pat: string) => {
    const want = pat.replace(/^%|%$/g, "").toLowerCase();
    tests.push((r) => String(r[c] ?? "").toLowerCase().includes(want));
    return b;
  };
  b.or = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows().filter((r) => tests.every((t) => t(r))), error: null }).then(res);
  return b;
}
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));

import { findNamedJobs } from "../note-job-server";

const job = (uuid: string, status: string, job_description: string, job_address = "12 Sample Road\nExampleton NSW 2000"): Row => ({
  uuid,
  org_id: "org-1",
  active: 1,
  generated_job_id: uuid.toUpperCase(),
  job_address,
  status,
  company_uuid: "c-1",
  date: "2026-11-01",
  job_description,
});
const byWork = { client: "", place: "", number: "", latest: false, work: "split system", open: true };

it("finds the open job whose work is the work said, not a finished one", async () => {
  jobs = [job("j1", "Quote", "Supply and install a 7kW split system"), job("j2", "Completed", "Split system service"), job("j3", "Quote", "Ducted system replacement")];
  const found = await findNamedJobs("org-1", byWork);
  expect(found.jobs.map((j) => j.uuid)).toEqual(["j1"]);
  expect(found.jobs[0]).toMatchObject({ client: "Sampleco Building", status: "Quote" });
});

it("finds nothing when no open job is that work", async () => {
  jobs = [job("j2", "Completed", "Split system service")];
  expect((await findNamedJobs("org-1", byWork)).jobs).toEqual([]);
});

it("narrows a place's jobs to the work said, when that leaves any", async () => {
  jobs = [job("j1", "Quote", "Split system"), job("j4", "Work Order", "Ducted install")];
  const found = await findNamedJobs("org-1", { ...byWork, place: "Exampleton" });
  expect(found.jobs.map((j) => j.uuid)).toEqual(["j1"]);
});
