/**
 * @jest-environment node
 */

/* The requests that write to ServiceM8 — what goes over the wire, and what
   an answer comes back as. The request is pinned field by field because the
   one thing ServiceM8 can't be asked twice about is a file put on a real
   customer's job: the record and its bytes go in one multipart POST, under
   OUR uuid, with the type read off the file's name. */

const fetchSm8Page = jest.fn();
jest.mock("../sm8-read", () => ({
  fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...a),
}));

import { postSm8Attachment, readSm8Attachment } from "../sm8-write";

const UPLOAD = {
  jobUuid: "job-uuid-1",
  uuid: "7d3f2c1e-5b6a-4c8d-9e0f-1a2b3c4d5e6f",
  fileName: "Public liability.pdf",
  mimeType: "application/pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchSm8Page.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("putting a file on a job", () => {
  it("is one multipart POST to attachment.json, the record and the bytes together", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { "x-record-uuid": UPLOAD.uuid } }));
    await postSm8Attachment("token-1", UPLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.servicem8.com/api_1.0/attachment.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    // no Content-Type of our own: fetch writes the multipart boundary
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();

    const form = init.body as FormData;
    expect(form.get("related_object")).toBe("job");
    expect(form.get("related_object_uuid")).toBe("job-uuid-1");
    expect(form.get("attachment_name")).toBe("Public liability.pdf");
    // OUR uuid, so a retry names the same record
    expect(form.get("uuid")).toBe(UPLOAD.uuid);
    const file = form.get("file") as File;
    expect(file.name).toBe("Public liability.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(UPLOAD.bytes);
  });

  it("leaves out what ServiceM8's guide says the multipart route decides for itself", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await postSm8Attachment("t", UPLOAD);
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.has("file_type")).toBe(false);
    expect(form.has("active")).toBe(false);
  });

  it("reads the new record's uuid off the header", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { "x-record-uuid": "theirs" } }));
    expect(await postSm8Attachment("t", UPLOAD)).toEqual({
      status: 200,
      outcome: { kind: "created", remoteUuid: "theirs" },
    });
  });

  it("answers a refusal as a decision, and logs ServiceM8's own words server-side only", async () => {
    fetchMock.mockResolvedValue(
      new Response('insufficient_scope: "manage_attachments" scope required', { status: 403 })
    );
    expect(await postSm8Attachment("t", UPLOAD)).toEqual({ status: 403, outcome: { kind: "forbidden" } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("manage_attachments"));
  });

  it("answers a lost connection as unreachable rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    expect(await postSm8Attachment("t", UPLOAD)).toEqual({
      status: null,
      outcome: { kind: "unavailable", status: null },
    });
  });
});

describe("confirming a 409 was ours", () => {
  it("asks the list endpoint for the one uuid, the path the mirror already reads through", async () => {
    fetchSm8Page.mockResolvedValue({
      ok: true,
      rows: [{ uuid: UPLOAD.uuid, related_object_uuid: "job-uuid-1", active: 1 }],
      nextCursor: null,
    });
    expect(await readSm8Attachment("t", UPLOAD.uuid)).toEqual({
      ok: true,
      found: true,
      jobUuid: "job-uuid-1",
      active: true,
    });
    expect(fetchSm8Page).toHaveBeenCalledWith("t", "attachment.json", {
      cursor: "-1",
      filter: `uuid eq '${UPLOAD.uuid}'`,
    });
  });

  it("never builds a filter from something that isn't a uuid", async () => {
    expect(await readSm8Attachment("t", "x' or '1' eq '1")).toEqual({ ok: true, found: false });
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });

  it("says not found, and couldn't tell, apart", async () => {
    fetchSm8Page.mockResolvedValueOnce({ ok: true, rows: [], nextCursor: null });
    expect(await readSm8Attachment("t", UPLOAD.uuid)).toEqual({ ok: true, found: false });
    fetchSm8Page.mockResolvedValueOnce({ ok: false, failure: "unavailable" });
    expect(await readSm8Attachment("t", UPLOAD.uuid)).toEqual({ ok: false });
  });
});
