/**
 * @jest-environment node
 */

/* A job video's words, once it's in: heard as it is, kept as captions
   beside the video and as one note on the job, and nothing kept for a clip
   that isn't a video on this job or that said nothing. */

const asked: string[] = [];
let doc: Record<string, unknown> | null = null;
let heard: unknown = null;

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: doc, error: null }) };
      return q;
    },
    storage: {
      from: () => ({
        download: async (ref: string) => (asked.push(`download ${ref}`), { data: new Blob(["mp4"]), error: null }),
        upload: async (ref: string, body: string, o: { contentType: string }) => (asked.push(`upload ${ref} ${o.contentType} ${body}`), { error: null }),
      }),
    },
  },
}));
jest.mock("@/lib/staff/aliases-query", () => ({ spokenStaffNames: async () => ["Sam"] }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/voice/transcribe", () => ({
  TRADE_KEYTERMS: ["grilles"],
  transcribeTimed: async (_b: Blob, name: string, o: { keyterms: string[] }) => (asked.push(`heard ${name} ${o.keyterms.join(",")}`), heard),
}));
jest.mock("@/lib/workboard/job-note-write", () => ({
  writeJobNote: async (n: { jobUuid: string; body: string; composeId: string }) => (asked.push(`note ${n.jobUuid} ${n.composeId} ${n.body}`), { id: n.composeId }),
}));

import { keepVideoWords } from "../job-video-words";

const VIDEO = { kind: "job_photo", mime_type: "video/mp4", storage_ref: "org/o/job_photo/d1.mp4", uploaded_at: "2026-11-26T22:43:37Z", sm8_job_uuid: "job-1" };
const run = () => keepVideoWords({ orgId: "o", userId: "u", jobUuid: "job-1", documentId: "d1" });

beforeEach(() => {
  asked.length = 0;
  doc = { ...VIDEO };
  heard = {
    ok: true,
    text: "The condenser goes here.",
    languageCode: "en",
    words: [
      { text: "The", start: 0, end: 0.2 },
      { text: "condenser", start: 0.2, end: 0.8 },
      { text: "goes", start: 0.8, end: 1 },
      { text: "here.", start: 1, end: 1.3 },
    ],
  };
});

it("keeps the captions beside the video and the words as one note on the job", async () => {
  expect(await run()).toBe("kept");
  expect(asked).toEqual([
    "download org/o/job_photo/d1.mp4",
    "heard video.mp4 Sam,grilles",
    `upload org/o/job_photo/d1.mp4.words.txt text/plain ${JSON.stringify({ v: 1, text: "The condenser goes here.", cues: [{ start: 0, end: 1.3, text: "The condenser goes here." }] })}`,
    "note job-1 d1 From the video at 9:43 am: The condenser goes here.",
  ]);
});

it("keeps nothing for a photo, another job's video, one not in yet, or a clip that said nothing", async () => {
  for (const d of [{ ...VIDEO, mime_type: "image/jpeg" }, { ...VIDEO, sm8_job_uuid: "job-2" }, { ...VIDEO, uploaded_at: null }, null]) {
    doc = d;
    expect(await run()).toBe("nothing");
  }
  expect(asked).toEqual([]);
  doc = { ...VIDEO };
  heard = { ok: false, error: "Nothing was said in that recording." };
  expect(await run()).toBe("nothing");
  expect(asked.some((a) => a.startsWith("note") || a.startsWith("upload"))).toBe(false);
});
