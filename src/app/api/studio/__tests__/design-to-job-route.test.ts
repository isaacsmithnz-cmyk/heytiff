/**
 * @jest-environment node
 */

/* A design onto a job — the gates, and nothing half-made left behind.
   What this pins: `studio` to ask and `workboard` to put a file on a job; the
   file lands on the job card first; it goes to ServiceM8 only for someone with
   `workboard_manage`; and a failed upload leaves neither a row nor an object.
   The renderer, the card's send and the database are stubbed. */

let orgId: string | null = "org-1";
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => {
    if (!orgId) throw new Error("Not authenticated");
    return { orgId, userId: "auth0|isaac" };
  },
}));

type Ctx = { orgId: string; userId: string; staffId: string | null; company: boolean; team: boolean };
let ctx: Ctx | null = null;
let jobReal = true;
jest.mock("@/lib/compliance/send", () => ({
  complianceContext: async () => ctx,
  jobIsReal: async () => jobReal,
  trimId: (v: unknown) => String(v ?? "").trim().slice(0, 80),
}));

const render = jest.fn();
jest.mock("@/lib/studio/pdf-render", () => ({ renderDesignPdf: (...a: unknown[]) => render(...a) }));

const send = jest.fn();
jest.mock("@/app/actions/job-sm8", () => ({ sendJobDocumentsToServiceM8: (...a: unknown[]) => send(...a) }));

/* a small recording stand-in for the two tables and the bucket touched */
const calls: string[] = [];
let uploadError: { message: string } | null = null;
jest.mock("@/lib/supabase-server", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.insert = (row: Record<string, unknown>) => {
      calls.push(`insert ${table} ${row.kind} ${row.sm8_job_uuid}`);
      return q;
    };
    q.update = (row: Record<string, unknown>) => {
      calls.push(`update ${table} ${Object.keys(row).join(",")}`);
      return q;
    };
    q.delete = () => {
      calls.push(`delete ${table}`);
      return q;
    };
    q.eq = self;
    q.select = self;
    q.maybeSingle = async () => ({ data: { id: "doc-9" }, error: null });
    q.then = (res: (v: { error: null }) => unknown) => res({ error: null });
    return q;
  };
  return {
    supabaseAdmin: {
      from: (t: string) => chain(t),
      storage: {
        from: () => ({
          upload: async (ref: string) => {
            calls.push(`upload ${ref}`);
            return { error: uploadError };
          },
          remove: async (refs: string[]) => {
            calls.push(`remove ${refs.join()}`);
            return { error: null };
          },
        }),
      },
    },
  };
});

import { POST } from "../design-to-job/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost:3000/api/studio/design-to-job", { method: "POST", body: JSON.stringify(body) }));
const BODY = { designId: "dsn_1", name: "85 West St", jobUuid: "job-1", options: { sections: { picklist: false } } };

beforeEach(() => {
  orgId = "org-1";
  ctx = { orgId: "org-1", userId: "auth0|isaac", staffId: "staff-1", company: true, team: true };
  jobReal = true;
  uploadError = null;
  calls.length = 0;
  render.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  send.mockReset().mockResolvedValue({ ok: true, trial: false, sent: ["d:doc-9"], waiting: [], failed: [], already: [], sends: [] });
});

it("files the PDF on the job card, then sends it to ServiceM8", async () => {
  const r = await (await post(BODY)).json();
  expect(r).toMatchObject({ ok: true, fileName: "85 West St.pdf" });
  expect(calls).toEqual([
    "insert documents job_document job-1",
    "upload org/org-1/job_document/doc-9.pdf",
    "update documents storage_ref,uploaded_at",
  ]);
  expect(send).toHaveBeenCalledWith({ jobUuid: "job-1", keys: ["d:doc-9"] });
  /* the ticks ride to the printer: this copy has no picklist */
  expect(render.mock.calls[0][0].options.sections.picklist).toBe(false);
});

it("puts it on the card but never sends for someone without workboard_manage", async () => {
  ctx = { ...ctx!, company: false };
  const r = await (await post(BODY)).json();
  expect(r).toEqual({ ok: true, fileName: "85 West St.pdf", sm8: null });
  expect(send).not.toHaveBeenCalled();
});

it("refuses someone who can't put files on jobs, before printing anything", async () => {
  ctx = null;
  const res = await post(BODY);
  expect(res.status).toBe(403);
  expect(render).not.toHaveBeenCalled();
});

it("refuses a job that is no longer in ServiceM8's copy", async () => {
  jobReal = false;
  expect(await (await post(BODY)).json()).toMatchObject({ ok: false });
  expect(render).not.toHaveBeenCalled();
});

it("leaves nothing half-made when the upload fails", async () => {
  uploadError = { message: "bucket said no" };
  const r = await (await post(BODY)).json();
  expect(r.ok).toBe(false);
  expect(calls).toContain("delete documents");
  expect(send).not.toHaveBeenCalled();
});
