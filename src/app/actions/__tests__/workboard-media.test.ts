/**
 * @jest-environment node
 */

/* Bringing a job's files across from ServiceM8. Pinned here: a file HeyTiff
   sent itself is never downloaded back (its bytes are ours already), the
   downloads count against the account's call limit on lane `read`, and a
   busy account ends the batch in words rather than skipping every file. */

type Row = Record<string, unknown>;

const SENT = "7d3f2c1e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const THEIRS_1 = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
const THEIRS_2 = "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0";

let attachments: Row[] = [];
let writeRows: Row[] = [];
const uploads: string[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "order"]) q[m] = () => q;
      q.limit = async () => ({ data: table === "sm8_attachments" ? attachments : [], error: null });
      q.or = async () => ({ data: table === "sm8_writes" ? writeRows : [], error: null });
      q.upsert = () => q;
      q.maybeSingle = async () => ({ data: { id: `doc-${uploads.length + 1}` }, error: null });
      q.update = () => q;
      q.then = (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
    storage: {
      from: () => ({
        upload: async (ref: string) => {
          uploads.push(ref);
          return { error: null };
        },
      }),
    },
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-1" }) } }));
jest.mock("@/lib/permissions-server", () => ({ can: async () => true }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8Access: async () => ({ accessToken: "tok", tenantId: "v-1", grant: "g", meter: "v-1" }),
}));
const fetchFile = jest.fn();
jest.mock("@/lib/integrations/sm8-attachment-file", () => ({
  fetchSm8AttachmentFile: (...a: unknown[]) => fetchFile(...a),
}));
jest.mock("@/lib/workboard/job-media-query", () => ({ readJobMediaGroups: jest.fn(async () => null) }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: jest.fn(async () => []) }));

import { cacheJobFiles } from "../workboard-media";
import { MEDIA_BUSY } from "@/lib/workboard/job-media";

const photo = (uuid: string): Row => ({
  uuid,
  attachment_name: "Photo",
  file_type: ".jpg",
  related_object_uuid: "job-1",
});

const JPEG = { ok: true, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]), contentType: "image/jpeg", kind: "jpeg" };

beforeEach(() => {
  attachments = [];
  writeRows = [];
  uploads.length = 0;
  fetchFile.mockReset().mockResolvedValue(JPEG);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("cacheJobFiles", () => {
  it("never downloads the copy of a file HeyTiff sent itself", async () => {
    attachments = [photo(SENT), photo(THEIRS_1)];
    writeRows = [{ remote_uuid: SENT, replaced_uuids: [] }];
    const res = await cacheJobFiles("job-1");
    expect(fetchFile.mock.calls.map((c) => c[1])).toEqual([THEIRS_1]);
    expect(res).toMatchObject({ ok: true, cached: 1, remaining: 0 });
  });

  it("downloads on lane `read`, counted against the connection's account", async () => {
    attachments = [photo(THEIRS_1)];
    await cacheJobFiles("job-1");
    expect(fetchFile).toHaveBeenCalledWith({ accessToken: "tok", meter: "v-1", lane: "read" }, THEIRS_1);
  });

  it("ends the batch when ServiceM8 is busy for the account, and says the rest come next time", async () => {
    attachments = [photo(THEIRS_1), photo(THEIRS_2)];
    fetchFile.mockResolvedValueOnce({ ok: false, reason: "busy" });
    const res = await cacheJobFiles("job-1");
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, cached: 0, remaining: 2, note: MEDIA_BUSY });
    expect(MEDIA_BUSY).toBe("ServiceM8 is busy. The rest will come across next time the job is opened.");
  });

  it("still skips just the one file that is gone, and carries on", async () => {
    attachments = [photo(THEIRS_1), photo(THEIRS_2)];
    fetchFile.mockResolvedValueOnce({ ok: false, reason: "gone" });
    const res = await cacheJobFiles("job-1");
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ cached: 1, note: null });
  });
});
