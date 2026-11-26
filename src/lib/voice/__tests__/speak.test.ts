/**
 * @jest-environment node
 */

/* Her voice: what an answer becomes when it's said (markdown out, a table
   pointed at once, a cap that says where the rest is), and the vendor call,
   whose every failure is either "use the device's voice" or "try again",
   never a vendor's words. */

import { capSaid, lineCleaner, REST_WORDS, sentencesOf, SPEAK_MAX_CHARS, speakable, TABLE_WORDS } from "../speak-words";
import { isSpeechConfigured, synthesize } from "../speak";

describe("speakable", () => {
  it("says the words and none of the marks that lay them out", () => {
    expect(speakable("## Two things\n\n- The **ceiling** height\n- The [main bedroom](https://x.test/a) unit\n\nShall I ask?")).toBe(
      "Two things. The ceiling height. The main bedroom unit. Shall I ask?"
    );
  });

  it("points at a table once and reads none of its cells", () => {
    expect(speakable("Here they are:\n| Room | kW |\n|---|---|\n| Living | 7.1 |\nThat's all.")).toBe(
      `Here they are: ${TABLE_WORDS} That's all.`
    );
  });

  it("leaves a fenced block out, and bare links", () => {
    expect(speakable("See https://x.test/q\n```\ncode\n```\nDone")).toBe("See. Done.");
  });

  it("cuts a long answer at a sentence and says the rest is on the screen", () => {
    const long = "This is a sentence. ".repeat(300);
    const said = speakable(long);
    expect(said.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS + REST_WORDS.length + 1);
    expect(said.endsWith(`sentence. ${REST_WORDS}`)).toBe(true);
  });

  it("is nothing when there's nothing to say", () => {
    expect(speakable("\n---\n```\nx\n```\n")).toBe("");
  });
});

describe("the pieces", () => {
  it("cleans a line at a time, a table across lines once", () => {
    const clean = lineCleaner();
    expect(["| a |", "| b |", "after"].map(clean)).toEqual([TABLE_WORDS, null, "after."]);
  });

  it("splits said words into sentences, keeping their ends", () => {
    expect(sentencesOf("Sam's free. Book him? Yes! And then")).toEqual(["Sam's free.", "Book him?", "Yes!", "And then"]);
  });

  it("caps under a length", () => {
    expect(capSaid("One. Two. Three.", 100)).toBe("One. Two. Three.");
    expect(capSaid("One two. Three four five six.", 12)).toBe(`One two. ${REST_WORDS}`);
  });
});

describe("synthesize", () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  afterEach(() => {
    process.env = { ...env };
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("falls back to the device's voice until a key and a voice are both set", async () => {
    delete process.env.ELEVENLABS_VOICE_ID;
    process.env.ELEVENLABS_API_KEY = "k";
    expect(isSpeechConfigured()).toBe(false);
    expect(await synthesize("Hi.")).toEqual({ ok: false, fallback: true });
  });

  it("streams her voice from the vendor's stream endpoint", async () => {
    process.env.ELEVENLABS_API_KEY = "k";
    process.env.ELEVENLABS_VOICE_ID = "v1";
    const seen: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init! });
      return new Response("mp3", { headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch;
    const r = await synthesize("Hi there.");
    expect(r.ok).toBe(true);
    expect(seen[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v1/stream?output_format=mp3_44100_64");
    expect((seen[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ text: "Hi there.", model_id: "eleven_v4_turbo" });
  });

  it("a key that can't speak is the device's voice; a busy vendor is try again", async () => {
    process.env.ELEVENLABS_API_KEY = "k";
    process.env.ELEVENLABS_VOICE_ID = "v1";
    jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(async () => new Response('{"detail":{"status":"missing_permissions"}}', { status: 401 })) as typeof fetch;
    expect(await synthesize("Hi.")).toEqual({ ok: false, fallback: true });
    global.fetch = jest.fn(async () => new Response("busy", { status: 429 })) as typeof fetch;
    expect(await synthesize("Hi.")).toEqual({ ok: false, fallback: false });
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await synthesize("Hi.")).toEqual({ ok: false, fallback: false });
  });
});
