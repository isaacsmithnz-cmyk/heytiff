/**
 * @jest-environment node
 */

/* A video's words with their times: word timestamps asked for, only words
   kept (no spacing, no sounds), and nothing said is nothing. */

import { transcribeTimed } from "../transcribe";

const realFetch = global.fetch;
const env = { ...process.env };
afterEach(() => {
  global.fetch = realFetch;
  process.env = { ...env };
});

it("asks for word times and keeps only the words", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  let form: FormData | null = null;
  global.fetch = jest.fn(async (_u: unknown, init?: RequestInit) => {
    form = init?.body as FormData;
    return new Response(
      JSON.stringify({
        text: "Condenser goes here.",
        language_code: "en",
        words: [
          { text: "Condenser", type: "word", start: 0.1, end: 0.6, logprob: 0 },
          { text: " ", type: "spacing", start: 0.6, end: 0.62, logprob: 0 },
          { text: "goes", type: "word", start: 0.62, end: 0.9, logprob: 0 },
          { text: "(cough)", type: "audio_event", start: 1, end: 1.2, logprob: 0 },
          { text: "here.", type: "word", start: 1.3, end: 1.6, logprob: 0 },
        ],
      })
    );
  }) as typeof fetch;
  const r = await transcribeTimed(new Blob(["x"]), "video.mp4", { keyterms: ["grilles"] });
  expect(r).toEqual({
    ok: true,
    text: "Condenser goes here.",
    languageCode: "en",
    words: [
      { text: "Condenser", start: 0.1, end: 0.6 },
      { text: "goes", start: 0.62, end: 0.9 },
      { text: "here.", start: 1.3, end: 1.6 },
    ],
  });
  expect(form!.get("timestamps_granularity")).toBe("word");
  expect(form!.get("model_id")).toBe("scribe_v2");
  expect((form!.get("file") as File).name).toBe("video.mp4");
  expect(form!.getAll("keyterms")).toEqual(["grilles"]);
});

it("nothing said, no key, or a refused call is never words", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  expect((await transcribeTimed(new Blob(["x"]), "v.mp4")).ok).toBe(false);
  process.env.ELEVENLABS_API_KEY = "k";
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ text: "  ", words: [] }))) as typeof fetch;
  expect(await transcribeTimed(new Blob(["x"]), "v.mp4")).toEqual({ ok: false, error: "Nothing was said in that recording." });
  jest.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = jest.fn(async () => new Response("no", { status: 500 })) as typeof fetch;
  expect((await transcribeTimed(new Blob(["x"]), "v.mp4")).ok).toBe(false);
});
