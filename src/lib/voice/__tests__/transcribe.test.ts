/* The keyterm rules, which cost real money to get wrong.

   ElevenLabs charges a 20% surcharge for keyterm biasing and imposes a
   20-second minimum billable duration per clip once you pass 100 terms — so
   the cap isn't tidiness, it's the bill. The per-term rules (under 50 chars,
   at most 5 words, no bracket characters) come from their API reference:
   a term that breaks one is rejected upstream, taking the whole request with
   it, so they're enforced here instead. */

import {
  isTranscriptionConfigured,
  KEYTERM_LIMIT,
  prepareKeyterms,
  TRADE_KEYTERMS,
  transcribeAudio,
} from "../transcribe";

describe("prepareKeyterms", () => {
  it("keeps ordinary trade words and staff names", () => {
    expect(prepareKeyterms(["Luke", "condensate", "return air"])).toEqual([
      "Luke",
      "condensate",
      "return air",
    ]);
  });

  it("trims, and drops the empty", () => {
    expect(prepareKeyterms(["  grille  ", "", "   "])).toEqual(["grille"]);
  });

  it("de-duplicates case-insensitively — the surcharge is per term", () => {
    expect(prepareKeyterms(["Grille", "grille", "GRILLE"])).toEqual(["Grille"]);
  });

  it("drops terms the vendor documents it will reject", () => {
    expect(prepareKeyterms(["a".repeat(50)])).toEqual([]); // 50 chars is not "less than 50"
    expect(prepareKeyterms(["one two three four five six"])).toEqual([]); // >5 words
    for (const bad of ["<grille>", "a{b}", "a[b]", "back\\slash"]) {
      expect(prepareKeyterms([bad])).toEqual([]);
    }
  });

  it("keeps the boundary cases that are legal", () => {
    expect(prepareKeyterms(["a".repeat(49)])).toHaveLength(1);
    expect(prepareKeyterms(["one two three four five"])).toHaveLength(1);
  });

  it("caps well below the 100 that triggers a 20-second minimum charge", () => {
    const many = Array.from({ length: 500 }, (_, i) => `term${i}`);
    const out = prepareKeyterms(many);
    expect(out).toHaveLength(KEYTERM_LIMIT);
    expect(KEYTERM_LIMIT).toBeLessThan(100);
  });

  it("the built-in trade list survives its own rules", () => {
    expect(prepareKeyterms(TRADE_KEYTERMS)).toHaveLength(TRADE_KEYTERMS.length);
  });
});

describe("isTranscriptionConfigured", () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  });

  it("is false without a key, so the caller offers a typed note instead", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(isTranscriptionConfigured()).toBe(false);
    process.env.ELEVENLABS_API_KEY = "k";
    expect(isTranscriptionConfigured()).toBe(true);
  });
});

describe("an upstream refusal", () => {
  /* The first live failure (2026-07-29) was undiagnosable: the adapter threw
     the status away, so a rejected key looked exactly like a malformed
     request. "Never forward a vendor's words" is a rule about the RESPONSE —
     the log is ours, and the status IS the diagnosis. */
  const realFetch = global.fetch;
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(console, "error").mockImplementation((m: unknown) => void logged.push(String(m)));
    process.env.ELEVENLABS_API_KEY = "test-key";
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    delete process.env.ELEVENLABS_API_KEY;
  });

  /* A plain stub, not `new Response(...)` — this jsdom has no Response global,
     and the adapter only ever reads these four things off a refusal. */
  const respond = (status: number, body: string) => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status,
      statusText: status === 401 ? "Unauthorized" : "Error",
      text: async () => body,
    })) as unknown as typeof fetch;
  };

  it("records the status and the vendor's body in the SERVER log", async () => {
    respond(401, '{"detail":"invalid_api_key"}');
    await transcribeAudio(new Blob(["x"]), {});
    expect(logged.join()).toContain("401");
    expect(logged.join()).toContain("invalid_api_key");
  });

  it("but the caller's sentence stays ours — no status, no vendor text", async () => {
    respond(403, '{"detail":"missing scope speech_to_text"}');
    const res = await transcribeAudio(new Blob(["x"]), {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("That recording couldn't be transcribed. Try again, or type it.");
      expect(res.error).not.toMatch(/403|scope|detail/i);
    }
  });

  it("an unreadable body still logs the status rather than throwing", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => {
        throw new Error("stream broken");
      },
    })) as unknown as typeof fetch;
    const res = await transcribeAudio(new Blob(["x"]), {});
    expect(res.ok).toBe(false);
    expect(logged.join()).toContain("429");
  });
});
