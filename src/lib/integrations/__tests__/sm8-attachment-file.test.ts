/**
 * @jest-environment node
 */

/* One attachment's bytes, through the one door: counted against the
   account's limit on the caller's lane, and "busy" — not a skipped file —
   when the account has no room. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

const takeTurn = jest.fn();
jest.mock("../sm8-meter", () => {
  const actual = jest.requireActual("../sm8-meter");
  return { ...actual, takeSm8Call: (...a: unknown[]) => takeTurn(...a), noteSm8Throttle: jest.fn(async () => {}) };
});

import { attachmentFilePath, fetchSm8AttachmentFile } from "../sm8-attachment-file";

const UUID = "7d3f2c1e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const READ = { accessToken: "tok", meter: "v-1", lane: "read" as const };
const fetchMock = jest.fn();
const realFetch = global.fetch;

beforeEach(() => {
  takeTurn.mockReset().mockResolvedValue({ ok: true });
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

describe("fetchSm8AttachmentFile", () => {
  it("asks for the verified path on the caller's lane, with a download's patience", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const file = await fetchSm8AttachmentFile(READ, UUID);
    expect(file).toMatchObject({ ok: true, kind: "jpeg", contentType: "image/jpeg" });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.servicem8.com/api_1.0/Attachment/${UUID}.file`);
    expect(attachmentFilePath(UUID)).toBe(`Attachment/${UUID}.file`);
    expect(takeTurn).toHaveBeenCalledWith("v-1", "read");
    expect(timeout).toHaveBeenLastCalledWith(45_000);
    timeout.mockRestore();
  });

  it("is busy, and asks nothing, when the account's counter has no turn", async () => {
    takeTurn.mockResolvedValue({ ok: false, waitMs: 60_000, why: "cooldown_minute" });
    expect(await fetchSm8AttachmentFile(READ, UUID)).toEqual({ ok: false, reason: "busy" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is busy when ServiceM8 says 429", async () => {
    fetchMock.mockResolvedValue(new Response("Number of allowed API requests per minute exceeded", { status: 429 }));
    expect(await fetchSm8AttachmentFile(READ, UUID)).toEqual({ ok: false, reason: "busy" });
  });

  it("keeps its other answers", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchSm8AttachmentFile(READ, UUID)).toEqual({ ok: false, reason: "gone" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await fetchSm8AttachmentFile(READ, UUID)).toEqual({ ok: false, reason: "unauthorized" });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await fetchSm8AttachmentFile(READ, UUID)).toEqual({ ok: false, reason: "unavailable" });
  });
});
