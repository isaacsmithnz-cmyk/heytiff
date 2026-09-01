/* THE READER HAD NO TESTS AT ALL, and that is the whole story of the six
   defects an audit found in it — including one that emptied the bank on every
   job in the account and raised no error anywhere.

   These pin the four that are about MONEY or LOST DATA. They drive the real
   action through mocked Supabase and Anthropic clients, because every one of
   those bugs lived in the wiring between them rather than in any pure
   function that could be tested on its own. */

/* TYPED, because jest transpiles without checking and the CI step does not.
   A bare `jest.fn()` infers `() => void`, so `.mock.calls[0][0]` is a tuple of
   length zero and every assertion on an argument is a typecheck error the
   test run itself never sees. */
const upsert = jest.fn(
  async (_row: Record<string, unknown>) => ({ error: null as { message: string } | null })
);
const messagesCreate = jest.fn(
  async (_req: { model: string; max_tokens: number }): Promise<unknown> => null
);
const download = jest.fn(async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(8) } }));

/** Rows `documents` will hand back — the job's cached files. */
let docRows: Record<string, unknown>[] = [];
/** Attachment uuids already in job_photo_readings. */
let doneRows: { sm8_attachment_uuid: string }[] = [];
/** Which of those are dataplates still on the cheap model — the upgrade queue. */
let plateRows: { sm8_attachment_uuid: string }[] = [];
/** Column filters the readings table was queried with, so a test can prove
    the upgrade pass asked for dataplates AND for the bank model. */
let readingFilters: [string, unknown][] = [];
/** Which sm8_job_uuids the documents read was scoped to. */
let documentsScopedTo: string[] | null = null;

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = (col: string, val: unknown) => {
    if (name === "job_photo_readings") readingFilters.push([col, val]);
    return chain;
  };
  chain.is = self;
  chain.not = self;
  chain.order = self;
  chain.select = self;
  chain.in = (col: string, vals: string[]) => {
    if (name === "documents" && col === "sm8_job_uuid") documentsScopedTo = vals;
    return chain;
  };
  chain.limit = async () =>
    name === "documents" ? { data: docRows, error: null } : { data: [], error: null };
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.upsert = (row: unknown) => upsert(row as Record<string, unknown>);
  /* `job_photo_readings`'s "what is already read" query ends on .in() and is
     awaited directly. */
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      name === "job_photo_readings"
        ? {
            /* The upgrade query is the one that filters on subject. */
            data: readingFilters.some(([c]) => c === "subject") ? plateRows : doneRows,
            error: null,
          }
        : { data: docRows, error: null }
    );
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (name: string) => table(name),
    storage: { from: () => ({ download: (...a: unknown[]) => download(...(a as [])) }) },
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "user-1" }),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
/* The job's claims. The reader must ask for these — the bug was that it
   never did, and every photo on a progress clone stayed outside the bank. */
const familyMediaSources = jest.fn(async () => [
  { remoteId: "job-1a", claimNumber: "907A" },
]);
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  familyMediaSources: (...a: unknown[]) => familyMediaSources(...(a as [])),
}));
jest.mock("@anthropic-ai/sdk", () => {
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  const Anthropic = function () {
    return {
      messages: {
        create: (req: unknown) => messagesCreate(req as { model: string; max_tokens: number }),
      },
    };
  } as unknown as { new (): unknown; AuthenticationError: unknown; RateLimitError: unknown };
  (Anthropic as unknown as Record<string, unknown>).AuthenticationError = AuthenticationError;
  (Anthropic as unknown as Record<string, unknown>).RateLimitError = RateLimitError;
  return { __esModule: true, default: Anthropic };
});
/* sharp is a native module; the reader imports it dynamically and falls back
   to the stored mime when it throws. Failing it here keeps these tests to the
   wiring rather than to image decoding. */
jest.mock("sharp", () => {
  throw new Error("no sharp in tests");
});

import { readJobPhotos } from "@/app/actions/photo-readings";

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d-1",
  remote_ref: "att-1",
  storage_ref: "org-1/job_file/att-1.jpg",
  /* ServiceM8's real filename: no extension, identical on every photo. */
  file_name: "Photo",
  mime_type: "image/jpeg",
  ...over,
});

const answered = (body: Record<string, unknown>, stop = "end_turn") => ({
  stop_reason: stop,
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

const goodReading = {
  subject: "dataplate",
  tags: ["mitsubishi"],
  caption: "A rating plate",
  text: "MODEL PUZ-M125VKA2-A",
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  messagesCreate.mockReset();
  messagesCreate.mockResolvedValue(answered(goodReading) as unknown);
  download.mockClear();
  familyMediaSources.mockClear();
  docRows = [doc()];
  doneRows = [];
  plateRows = [];
  readingFilters = [];
  documentsScopedTo = null;
});

/* ── the claims' photos are the job's photos ── */

/* ServiceM8 bills a progress job by CLONING it, and the cacher deliberately
   files a clone's photo under the CLAIM's uuid. A reader scoped to the parent
   alone found none of them: 626 live photographs, cached and displayed and
   starrable, permanently outside the bank — while the job reported
   `remaining: 0`. */
it("asks for the claims' photos too, not just the parent's", async () => {
  await readJobPhotos("job-1");
  expect(familyMediaSources).toHaveBeenCalledWith("org-1", "job-1");
  expect(documentsScopedTo).toEqual(["job-1", "job-1a"]);
});

/* ── a star must read ITS photo ── */

/* The showcase tier's queue is photos that are UNREAD, and a starred photo has
   by definition already been read by the bank. So the star skipped its own
   photograph and spent Opus money on up to four arbitrary others. */
it("re-reads the named photo even though the bank already read it", async () => {
  docRows = [doc({ remote_ref: "att-1" }), doc({ id: "d-2", remote_ref: "att-2" })];
  doneRows = [{ sm8_attachment_uuid: "att-1" }, { sm8_attachment_uuid: "att-2" }];

  const res = await readJobPhotos("job-1", "showcase", "att-1");

  expect(res.read).toBe(1);
  expect(messagesCreate).toHaveBeenCalledTimes(1);
  /* And with the better model — that is the entire point of a star. */
  expect(messagesCreate.mock.calls[0][0].model).toBe("claude-opus-5");
  expect(upsert.mock.calls[0][0]).toMatchObject({ sm8_attachment_uuid: "att-1" });
});

it("does not spend on other photos when one is named", async () => {
  docRows = [doc({ remote_ref: "att-1" }), doc({ id: "d-2", remote_ref: "att-2" })];
  doneRows = [];
  await readJobPhotos("job-1", "showcase", "att-1");
  expect(messagesCreate).toHaveBeenCalledTimes(1);
});

it("reads with the cheap model when nothing is named", async () => {
  await readJobPhotos("job-1");
  expect(messagesCreate.mock.calls[0][0].model).toBe("claude-haiku-4-5");
});

/* ── a truncated or refused answer is not a reading ── */

/* The unique index means a photo written once is NEVER looked at again, so a
   blank row from a cut-off response is permanent data loss. Leaving it out of
   the table is the honest state: this photograph has not been read yet. */
it("leaves a truncated answer unread rather than banking a blank", async () => {
  messagesCreate.mockResolvedValue(answered(goodReading, "max_tokens") as unknown);
  const res = await readJobPhotos("job-1");
  expect(upsert).not.toHaveBeenCalled();
  expect(res.read).toBe(0);
});

it("leaves a refused answer unread too", async () => {
  messagesCreate.mockResolvedValue(answered(goodReading, "refusal") as unknown);
  await readJobPhotos("job-1");
  expect(upsert).not.toHaveBeenCalled();
});

/* ── what is counted is what was STORED ── */

/* Counting the CALL meant a failing upsert reported `{ok:true, read:1}` with
   nothing written; the next round recomputed the queue from an empty table and
   billed the same photograph again. */
it("does not count a reading it could not save", async () => {
  upsert.mockResolvedValue({ error: { message: "relation does not exist" } });
  const res = await readJobPhotos("job-1");

  expect(res.read).toBe(0);
  /* and it says so, rather than looking like a job with nothing to do */
  expect(res.ok).toBe(false);
  expect(res.remaining).toBeGreaterThan(0);
  expect(res.note).toMatch(/couldn't be saved/i);
});

it("reports a clean read normally", async () => {
  const res = await readJobPhotos("job-1");
  expect(res).toMatchObject({ ok: true, read: 1, remaining: 0 });
});

/* ── the filename trap, one layer up from isBankablePhoto ── */

/* ServiceM8 names every attachment `Photo` with no extension. A filter that
   derived the type from the name excluded every photograph in the account. */
it("reads a photo whose only name is `Photo`", async () => {
  docRows = [doc({ file_name: "Photo", mime_type: "image/jpeg" })];
  const res = await readJobPhotos("job-1");
  expect(res.read).toBe(1);
});

it("leaves paper out of the bank", async () => {
  docRows = [doc({ file_name: "Partial Invoice #907A", mime_type: "application/pdf" })];
  const res = await readJobPhotos("job-1");
  expect(res).toMatchObject({ read: 0, remaining: 0 });
  expect(messagesCreate).not.toHaveBeenCalled();
});

/* A workspace with no key still caches and shows its photos; it simply has no
   bank, and that is not an error. */
it("says nothing and spends nothing without a key", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await readJobPhotos("job-1");
  expect(res).toMatchObject({ ok: true, read: 0 });
  expect(messagesCreate).not.toHaveBeenCalled();
});


/* ── the dataplate upgrade ────────────────────────────────────────────────
   Haiku gets every subject right and everything a person is likely to type,
   but it garbles dense small print CONFIDENTLY — verified side by side on the
   SAME photograph:

       AS/NZS 4755 SELV DC Power DRM1   Opus
       ASICS 4793 BBV L2 DUNet 90       Haiku

   On ductwork that costs nothing. A dataplate is small print end to end, and
   a confidently wrong serial in an index is worse than a missing one: the
   search finds nothing while the row insists otherwise.

   NOT the reason first given. That was a model number read two ways across
   two photographs — which turned out to be two different outdoor units, with
   two different serials, both read correctly. See photo-readings.ts. */

it("re-reads a dataplate with the better model", async () => {
  docRows = [doc({ remote_ref: "att-1" })];
  doneRows = [{ sm8_attachment_uuid: "att-1" }];
  plateRows = [{ sm8_attachment_uuid: "att-1" }];

  const res = await readJobPhotos("job-1", "upgrade");

  expect(res.read).toBe(1);
  expect(messagesCreate.mock.calls[0][0].model).toBe("claude-opus-5");
});

/* THE ONLY QUEUE HERE THAT READS WHAT IS ALREADY READ, so it has to be
   narrow: it asks for the subject AND for the cheap model, or it would
   re-read Opus's own work forever at Opus prices. */
it("asks only for dataplates the cheap model read", async () => {
  docRows = [doc({ remote_ref: "att-1" })];
  plateRows = [{ sm8_attachment_uuid: "att-1" }];
  await readJobPhotos("job-1", "upgrade");

  expect(readingFilters).toContainEqual(["subject", "dataplate"]);
  expect(readingFilters).toContainEqual(["read_model", "claude-haiku-4-5"]);
});

/* A photograph of ductwork read by Haiku stays read by Haiku forever. That
   is the whole reason this is affordable — dataplates are 5.7% of the bank. */
it("leaves everything that is not a dataplate alone", async () => {
  docRows = [doc({ remote_ref: "att-1" }), doc({ id: "d-2", remote_ref: "att-2" })];
  doneRows = [{ sm8_attachment_uuid: "att-1" }, { sm8_attachment_uuid: "att-2" }];
  plateRows = [];

  const res = await readJobPhotos("job-1", "upgrade");

  expect(res).toMatchObject({ ok: true, read: 0, remaining: 0 });
  expect(messagesCreate).not.toHaveBeenCalled();
});

/* The bank tier must not have acquired the upgrade's appetite. */
it("does not re-read anything on the ordinary bank pass", async () => {
  docRows = [doc({ remote_ref: "att-1" })];
  doneRows = [{ sm8_attachment_uuid: "att-1" }];
  plateRows = [{ sm8_attachment_uuid: "att-1" }];

  const res = await readJobPhotos("job-1");

  expect(res.read).toBe(0);
  expect(messagesCreate).not.toHaveBeenCalled();
});
