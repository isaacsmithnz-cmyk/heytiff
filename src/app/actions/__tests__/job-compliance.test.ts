/**
 * @jest-environment node
 */

/* Compliance on a job, and sending what's on it — the gates and the letter.

   What this pins is WHO may do WHAT, and what leaves: the business's papers
   need `workboard_manage`, a person's need `team`, sending needs
   `workboard_manage` and a ticket goes only where its scan may open; every id
   from the browser is re-resolved on this job in this org; an expired
   certificate is never added or sent; and the letter leaves in the business's
   name, replies reach the sender, the sender gets a copy, and the diary says
   what went. The reads themselves are lib/compliance's and are stubbed here. */

jest.unmock("@/app/actions/job-compliance");

type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: [string, string, unknown][];
  values?: unknown;
};
const calls: Call[] = [];
let respond: (c: Call) => { data?: unknown; error?: unknown } = () => ({ data: null });
const downloaded: string[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.insert = (v: unknown) => {
        call.op = "insert";
        call.values = v;
        return q;
      };
      q.update = (v: unknown) => {
        call.op = "update";
        call.values = v;
        return q;
      };
      q.delete = () => {
        call.op = "delete";
        return q;
      };
      for (const f of ["eq", "in", "is", "not", "order"])
        q[f] = (col: string, val: unknown) => {
          call.filters.push([f, col, val]);
          return q;
        };
      q.maybeSingle = async () => respond(call);
      q.single = async () => respond(call);
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(respond(call)).then(res, rej);
      return q;
    },
    storage: {
      from: () => ({
        download: async (ref: string) => {
          downloaded.push(ref);
          return { data: { arrayBuffer: async () => new TextEncoder().encode(`bytes of ${ref}`).buffer }, error: null };
        },
      }),
    },
  },
}));

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|isaac" }, orgId: "org-1" })) },
}));
let caps = new Set(["workboard", "workboard_manage", "team"]);
jest.mock("@/lib/permissions-server", () => ({ can: async (cap: string) => caps.has(cap) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-isaac") }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: jest.fn(async () => ({ warnDays: 30, email: true })) }));
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-09-23" }));
jest.mock("next/headers", () => ({ headers: async () => new Map([["host", "go.hey-tiff.com"]]) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: jest.fn(async () => [{ remoteId: "claim-1" }]) }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-isaac", "Isaac Smith"]])),
}));
jest.mock("@/lib/staff/query", () => ({
  emailsByUser: jest.fn(async () => new Map([["auth0|isaac", "isaac@diamondair.com.au"]])),
}));

const sendEmail = jest.fn(async (_letter: Record<string, unknown>) => ({ ok: true }) as Record<string, unknown>);
jest.mock("@/lib/email/send", () => ({
  isEmailConfigured: () => true,
  sendEmail: (letter: Record<string, unknown>) => sendEmail(letter),
}));

const q = {
  readJobPapers: jest.fn(),
  readPaperChoices: jest.fn(),
  readPaperOffer: jest.fn(),
  currentPaperOf: jest.fn(),
  jobPaperRows: jest.fn(),
};
jest.mock("@/lib/compliance/query", () => ({
  readJobPapers: (...a: unknown[]) => q.readJobPapers(...a),
  readPaperChoices: (...a: unknown[]) => q.readPaperChoices(...a),
  readPaperOffer: (...a: unknown[]) => q.readPaperOffer(...a),
  currentPaperOf: (...a: unknown[]) => q.currentPaperOf(...a),
  jobPaperRows: (...a: unknown[]) => q.jobPaperRows(...a),
}));

import type { JobPaper, PaperChoice } from "@/lib/compliance/papers";
import {
  addJobPapers,
  emailJobDocuments,
  listJobPapers,
  readComplianceChoices,
  removeJobPaper,
  renewJobPaper,
} from "../job-compliance";

const choice = (over: Partial<PaperChoice>): PaperChoice => ({
  key: "c:pl",
  kind: "company",
  name: "Public liability",
  person: null,
  issuer: "QBE",
  expiresOn: "2027-06-30",
  state: "ok",
  files: 1,
  booked: false,
  onJob: false,
  ...over,
});

const paper = (over: Partial<JobPaper> = {}): JobPaper => ({
  id: "jp-1",
  kind: "company",
  name: "Public liability",
  person: null,
  issuer: "QBE",
  expiresOn: "2027-06-30",
  state: "ok",
  renewed: false,
  files: [{ id: "doc-pl", fileName: "IMG_1.pdf", mimeType: "application/pdf", sizeBytes: 1000, url: "https://x/pl" }],
  addedBy: "Isaac Smith",
  addedAt: "2026-09-23T00:00:00Z",
  manage: true,
  ...over,
});

const writes = () => calls.filter((c) => c.op !== "select");

/* the mirror holds job-1; documents answer by what was asked for */
const baseRespond = (c: Call): { data?: unknown; error?: unknown } => {
  if (c.table === "sm8_jobs") return { data: c.filters.some(([, , v]) => v === "job-1") ? { uuid: "job-1" } : null };
  if (c.table === "organizations") return { data: { trading_name: "Diamond Air" } };
  if (c.table === "workboard_notes") return { data: { id: "note-1", applied_at: "2026-09-23T02:00:00Z", created_at: "x" } };
  if (c.table === "job_compliance" && c.op === "insert")
    return { data: (c.values as unknown[]).map((_, i) => ({ id: `new-${i}` })), error: null };
  if (c.table === "documents") {
    if (c.filters.some(([f, col]) => f === "eq" && col === "kind"))
      return { data: [{ storage_ref: "org/org-1/job_document/u1.pdf", file_name: "Certificate of compliance.pdf", mime_type: "application/pdf", size_bytes: 2000 }] };
    if (c.filters.some(([, col]) => col === "remote_ref"))
      return { data: [{ storage_ref: "org/org-1/job_file/q1.pdf", file_name: "Quote #2380", mime_type: "application/pdf", size_bytes: 3000 }] };
    return { data: [{ id: "doc-pl", storage_ref: "org/org-1/org_insurance/doc-pl.pdf", size_bytes: 1000 }] };
  }
  return { data: null, error: null };
};

beforeEach(() => {
  caps = new Set(["workboard", "workboard_manage", "team"]);
  calls.length = 0;
  downloaded.length = 0;
  respond = baseRespond;
  sendEmail.mockClear();
  sendEmail.mockImplementation(async () => ({ ok: true }));
  for (const fn of Object.values(q)) fn.mockReset();
  q.readJobPapers.mockResolvedValue([paper()]);
  q.readPaperOffer.mockResolvedValue({ company: [], staff: [] });
});

describe("reading", () => {
  it("is the card's own tier, and says what the viewer may do", async () => {
    caps = new Set(["workboard"]);
    expect(await listJobPapers("job-1")).toEqual({ papers: [paper()], may: { company: false, staff: false, send: false } });
    caps = new Set(["workboard", "workboard_manage", "team"]);
    expect((await listJobPapers("job-1"))?.may).toEqual({ company: true, staff: true, send: true });
    caps = new Set();
    expect(await listJobPapers("job-1")).toBeNull();
  });

  it("signs a ticket's scan only for team or its holder — the viewer goes to the read", async () => {
    caps = new Set(["workboard"]);
    await listJobPapers("job-1");
    expect(q.readJobPapers).toHaveBeenCalledWith("org-1", "job-1", expect.objectContaining({ staffId: "staff-isaac", team: false, company: false }));
  });

  it("offers only the sides the viewer may add, and nothing to someone who may add neither", async () => {
    caps = new Set(["workboard", "team"]);
    q.readPaperChoices.mockResolvedValue({ company: null, staff: [] });
    await readComplianceChoices("job-1");
    expect(q.readPaperChoices).toHaveBeenCalledWith("org-1", "job-1", expect.objectContaining({ company: false, staff: true }));
    caps = new Set(["workboard"]);
    expect(await readComplianceChoices("job-1")).toBeNull();
  });
});

describe("adding", () => {
  it("pins each paper to its current term, says who added it, and skips what the job already holds", async () => {
    q.readPaperOffer.mockResolvedValue({
      company: [
        { choice: choice({ key: "c:pl" }), termId: "rec-2027" },
        { choice: choice({ key: "c:wc", name: "Workers compensation", onJob: true }), termId: "rec-wc" },
      ],
      staff: [{ choice: choice({ key: "l:arc", kind: "staff", name: "ARC licence", person: "Dane Whitmore" }), termId: "term-9" }],
    });
    expect(await addJobPapers("job-1", ["c:pl", "c:wc", "l:arc", "c:pl"])).toEqual({ ok: true, added: ["new-0", "new-1"] });
    const [insert] = writes();
    expect(insert.table).toBe("job_compliance");
    expect(insert.values).toEqual([
      expect.objectContaining({ org_id: "org-1", sm8_job_uuid: "job-1", org_credential_id: "pl", credential_record_id: "rec-2027", staff_licence_id: null, added_by: "staff-isaac" }),
      expect.objectContaining({ staff_licence_id: "arc", licence_record_id: "term-9", org_credential_id: null }),
    ]);
  });

  it("needs workboard_manage for the business's papers and team for a person's", async () => {
    caps = new Set(["workboard", "team"]);
    expect(await addJobPapers("job-1", ["c:pl"])).toEqual({ ok: false, error: "You can't add the business's papers to jobs." });
    caps = new Set(["workboard", "workboard_manage"]);
    expect(await addJobPapers("job-1", ["l:arc"])).toEqual({ ok: false, error: "You can't add staff licences to jobs." });
    expect(writes()).toHaveLength(0);
  });

  it("re-resolves the job in this org's mirror rather than trusting the id", async () => {
    expect(await addJobPapers("job-elsewhere", ["c:pl"])).toEqual({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
    expect(writes()).toHaveLength(0);
  });

  it("never puts an expired certificate, or a card with nothing filed, on a job", async () => {
    q.readPaperOffer.mockResolvedValue({ company: [{ choice: choice({ state: "bad" }), termId: "r" }], staff: null });
    expect(await addJobPapers("job-1", ["c:pl"])).toEqual({ ok: false, error: "Public liability has expired." });
    q.readPaperOffer.mockResolvedValue({
      company: null,
      staff: [{ choice: choice({ key: "l:arc", kind: "staff", name: "ARC licence", person: "Dane Whitmore", files: 0 }), termId: null }],
    });
    expect(await addJobPapers("job-1", ["l:arc"])).toEqual({ ok: false, error: "Dane Whitmore's ARC licence has nothing on file to give." });
    expect(writes()).toHaveLength(0);
  });

  it("reads nothing into keys that aren't keys", async () => {
    expect(await addJobPapers("job-1", ["x:1", "c:", "garbage"])).toEqual({ ok: false, error: "Tick something to add." });
  });

  it("treats a double press racing to the unique index as already done", async () => {
    q.readPaperOffer.mockResolvedValue({ company: [{ choice: choice({}), termId: "r" }], staff: null });
    respond = (c) => (c.table === "job_compliance" && c.op === "insert" ? { data: null, error: { code: "23505" } } : baseRespond(c));
    expect(await addJobPapers("job-1", ["c:pl"])).toEqual({ ok: true, added: [] });
  });
});

describe("taking off and renewing", () => {
  const staffRow = { id: "jp-9", org_credential_id: null, staff_licence_id: "arc", credential_record_id: null, licence_record_id: "t1" };

  it("takes a person's ticket off only with team, and only in this org", async () => {
    q.jobPaperRows.mockResolvedValue([staffRow]);
    caps = new Set(["workboard", "workboard_manage"]);
    expect(await removeJobPaper("jp-9")).toEqual({ ok: false, error: "You can't take that off the job." });
    caps = new Set(["workboard", "team"]);
    expect(await removeJobPaper("jp-9")).toEqual({ ok: true });
    const [del] = writes();
    expect(del).toMatchObject({ table: "job_compliance", op: "delete" });
    expect(del.filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "id", "jp-9"]]));
  });

  it("moves the pin to the renewal, and only when there is one with paper", async () => {
    q.jobPaperRows.mockResolvedValue([staffRow]);
    q.currentPaperOf.mockResolvedValue({ termId: "t2", files: 2, expired: false });
    expect(await renewJobPaper("jp-9")).toEqual({ ok: true });
    expect(writes()[0]).toMatchObject({ table: "job_compliance", op: "update", values: { licence_record_id: "t2" } });

    calls.length = 0;
    q.currentPaperOf.mockResolvedValue({ termId: "t2", files: 0, expired: false });
    expect(await renewJobPaper("jp-9")).toEqual({ ok: false, error: "There's no renewal on file to use." });
    expect(writes()).toHaveLength(0);
  });
});

describe("emailing", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    jobUuid: "job-1",
    keys: ["p:jp-1", "d:u1", "f:q1"],
    to: ["jane@abcbuilders.com.au"],
    subject: "Documents for job 2380",
    message: "Hi Jane,\n\nAttached.",
    ...over,
  });

  it("sends every ticked file under the name of what it is, in the business's name, replies to the sender", async () => {
    const res = await emailJobDocuments(input());
    expect(res).toEqual({
      ok: true,
      to: ["jane@abcbuilders.com.au"],
      note: expect.objectContaining({ id: "note-1", author: "Isaac Smith" }),
    });
    const letter = sendEmail.mock.calls[0][0] as {
      to: string[];
      subject: string;
      replyTo: string;
      bcc: string[];
      fromName: string;
      attachments: { filename: string; content: string }[];
      html: string;
    };
    expect(letter.to).toEqual(["jane@abcbuilders.com.au"]);
    expect(letter.fromName).toBe("Diamond Air via HeyTiff");
    expect(letter.replyTo).toBe("isaac@diamondair.com.au");
    expect(letter.bcc).toEqual(["isaac@diamondair.com.au"]);
    expect(letter.attachments.map((a) => a.filename)).toEqual([
      "Public liability.pdf",
      "Certificate of compliance.pdf",
      "Quote #2380.pdf",
    ]);
    expect(Buffer.from(letter.attachments[0].content, "base64").toString()).toBe("bytes of org/org-1/org_insurance/doc-pl.pdf");
    expect(letter.html).toContain("Documents from Diamond Air");
  });

  it("finds ServiceM8's files on the job's claims too, and ours on this job alone", async () => {
    await emailJobDocuments(input());
    const docReads = calls.filter((c) => c.table === "documents");
    const theirs = docReads.find((c) => c.filters.some(([, col]) => col === "remote_ref"))!;
    expect(theirs.filters).toEqual(
      expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "source", "servicem8"], ["in", "sm8_job_uuid", ["job-1", "claim-1"]]])
    );
    const ours = docReads.find((c) => c.filters.some(([f, col]) => f === "eq" && col === "kind"))!;
    expect(ours.filters).toEqual(expect.arrayContaining([["eq", "kind", "job_document"], ["eq", "sm8_job_uuid", "job-1"]]));
  });

  it("writes what went, and to whom, on the job's diary", async () => {
    await emailJobDocuments(input());
    const note = writes().find((c) => c.table === "workboard_notes")!;
    expect(note.values).toMatchObject({
      org_id: "org-1",
      author_id: "staff-isaac",
      target_kind: "job",
      target_id: "job-1",
      transcript: "Emailed Public liability, Certificate of compliance.pdf and Quote #2380 to jane@abcbuilders.com.au.",
    });
  });

  it("needs workboard_manage", async () => {
    caps = new Set(["workboard", "team"]);
    expect(await emailJobDocuments(input())).toEqual({ ok: false, error: "You can't email documents from jobs." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends to somebody, to addresses, and to no more than a handful", async () => {
    expect(await emailJobDocuments(input({ to: [] }))).toEqual({ ok: false, error: "Say who it's going to." });
    expect(await emailJobDocuments(input({ to: ["jane at abc"] }))).toEqual({ ok: false, error: "jane at abc isn't an email address." });
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@abc.com.au`);
    expect(await emailJobDocuments(input({ to: many }))).toEqual({ ok: false, error: "An email goes to 10 people at most." });
    expect(await emailJobDocuments(input({ subject: "  " }))).toEqual({ ok: false, error: "Give the email a subject." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never sends an expired certificate, or a ticket whose scan won't open for the sender", async () => {
    q.readJobPapers.mockResolvedValue([paper({ state: "bad" })]);
    expect(await emailJobDocuments(input({ keys: ["p:jp-1"] }))).toEqual({
      ok: false,
      error: "Public liability on this job has expired. Use the renewal, or untick it.",
    });
    q.readJobPapers.mockResolvedValue([
      paper({ kind: "staff", name: "ARC licence", person: "Dane Whitmore", files: [{ ...paper().files[0], url: null }] }),
    ]);
    expect(await emailJobDocuments(input({ keys: ["p:jp-1"] }))).toEqual({ ok: false, error: "You can't send Dane Whitmore's ARC licence." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("says a paper that has left the job has left, rather than sending less than was ticked", async () => {
    q.readJobPapers.mockResolvedValue([]);
    expect(await emailJobDocuments(input({ keys: ["p:jp-1"] }))).toEqual({
      ok: false,
      error: "One of those is no longer on the job. Close the card and open it again.",
    });
  });

  it("won't try to send more than one email carries", async () => {
    respond = (c) =>
      c.table === "documents" && c.filters.some(([f, col]) => f === "eq" && col === "kind")
        ? { data: [{ storage_ref: "org/org-1/job_document/big.pdf", file_name: "Plans.pdf", mime_type: "application/pdf", size_bytes: 30 * 1024 * 1024 }] }
        : baseRespond(c);
    const res = await emailJobDocuments(input({ keys: ["d:u1"] }));
    expect(res).toEqual({ ok: false, error: "Those come to 30 MB, and one email takes 25 MB. Untick some and send them in two." });
    expect(downloaded).toEqual([]);
  });

  it("says a deployment with no mail key sent nothing", async () => {
    sendEmail.mockImplementation(async () => ({ ok: false, reason: "unconfigured" }));
    expect(await emailJobDocuments(input())).toEqual({ ok: false, error: "Email isn't set up on this deployment, so nothing was sent." });
    expect(writes().some((c) => c.table === "workboard_notes")).toBe(false);
  });
});
