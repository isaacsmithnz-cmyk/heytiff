/* Deleting a certificate: every version and every PDF it filed on the job,
   and only for a manager or whoever signed its latest version. The
   certifier's list it was read from is somebody's own file and stays. */

/* jest.setup stubs this module for every suite that renders the job card */
jest.unmock("@/app/actions/certificates");

let manage = false;
let cert: Record<string, unknown> | null = { id: "c-1" };
let versions: Record<string, unknown>[] = [];
let docs: Record<string, unknown>[] = [];

type Op = { table: string; op: string; filters: [string, string, unknown][] };
const ops: Op[] = [];
const removed: string[][] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const op: Op = { table, op: "select", filters: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.order = () => q;
      q.delete = () => {
        op.op = "delete";
        return q;
      };
      for (const f of ["eq", "in", "is"]) {
        q[f] = (col: string, val: unknown) => {
          op.filters.push([f, col, val]);
          return q;
        };
      }
      q.maybeSingle = async () => ({ data: table === "certificates" ? cert : null });
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          op.op === "delete" ? { error: null } : { data: table === "certificate_versions" ? versions : table === "documents" ? docs : [], error: null }
        ).then(res);
      return q;
    },
    storage: {
      from: () => ({
        remove: async (refs: string[]) => {
          removed.push(refs);
          return { error: null };
        },
      }),
    },
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(async () => ({ orgId: "org-1", userId: "auth0|u" })),
  can: jest.fn(async (cap: string) => cap === "workboard_manage" && manage),
  getDbRole: jest.fn(async () => "member"),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: jest.fn(async () => "staff-1") }));

import { deleteCertificate } from "../certificates";

const deletes = () => ops.filter((o) => o.op === "delete");

beforeEach(() => {
  manage = false;
  cert = { id: "c-1" };
  versions = [
    { version: 2, document_id: "d-2", issued_by_staff_id: "staff-1" },
    { version: 1, document_id: "d-1", issued_by_staff_id: "staff-9" },
  ];
  docs = [
    { id: "d-2", kind: "job_document", storage_ref: "org/org-1/job_document/d-2.pdf" },
    { id: "d-1", kind: "job_document", storage_ref: "org/org-1/job_document/d-1.pdf" },
  ];
  ops.length = 0;
  removed.length = 0;
});

it("deletes the certificate and every version's PDF for whoever signed the latest version", async () => {
  expect(await deleteCertificate("c-1")).toEqual({ ok: true });
  expect(deletes().map((o) => o.table)).toEqual(["certificates", "documents"]);
  expect(deletes()[0].filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "id", "c-1"]]));
  expect(deletes()[1].filters).toEqual(expect.arrayContaining([["in", "id", ["d-2", "d-1"]]]));
  expect(removed).toEqual([["org/org-1/job_document/d-2.pdf", "org/org-1/job_document/d-1.pdf"]]);
});

it("lets a manager delete one somebody else signed", async () => {
  manage = true;
  versions[0].issued_by_staff_id = "staff-9";
  expect(await deleteCertificate("c-1")).toEqual({ ok: true });
});

it("refuses anyone else, and touches nothing", async () => {
  versions[0].issued_by_staff_id = "staff-9";
  versions[1].issued_by_staff_id = "staff-1";
  expect(await deleteCertificate("c-1")).toEqual({ ok: false, error: "Only a manager, or whoever signed it, can delete this certificate." });
  expect(deletes()).toEqual([]);
  expect(removed).toEqual([]);
});

it("leaves a file that isn't ours, or isn't this org's, where it is", async () => {
  docs = [
    { id: "d-2", kind: "job_file", storage_ref: "org/org-1/job_file/d-2.pdf" },
    { id: "d-1", kind: "job_document", storage_ref: "org/org-2/job_document/d-1.pdf" },
  ];
  expect(await deleteCertificate("c-1")).toEqual({ ok: true });
  expect(deletes().map((o) => o.table)).toEqual(["certificates"]);
  expect(removed).toEqual([]);
});

it("says so when the certificate is already gone", async () => {
  cert = null;
  expect(await deleteCertificate("c-1")).toEqual({ ok: false, error: "That certificate is already gone." });
  expect(deletes()).toEqual([]);
});
