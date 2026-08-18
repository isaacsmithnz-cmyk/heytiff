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
      /* A rejected key is a dead end, so it takes the sentence for a
         deployment that cannot hear rather than one inviting a retry — and
         either way it carries none of the vendor's words. */
      expect(res.error).toBe("Voice notes aren't switched on yet — type it instead.");
      expect(res.error).not.toMatch(/403|scope|detail/i);
    }
  });

  /* RUNNING OUT IS NOT AN ERROR, IT IS A BILL — and it cost an afternoon on
     2026-08-17. Every recording came back "Try again, or type it"; the mic
     was fine, the upload was fine, and ElevenLabs was answering 401
     `quota_exceeded` with one credit left of ten thousand. The card was
     inviting a retry that could not succeed, for a reason no retry could
     reach, and only a server log said so. */
  it("says the account is out of credit, and does NOT invite a retry", async () => {
    respond(
      401,
      '{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota of 10000. You have 1 credits remaining, while 8 credits are required for this request."}}'
    );
    const res = await transcribeAudio(new Blob(["x"]), {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Voice notes have run out of credit — type it instead, and tell the office.");
      expect(res.error).not.toMatch(/try again/i);
      // still ours: no quota figures, no vendor phrasing
      expect(res.error).not.toMatch(/10000|quota|credits remaining/i);
    }
  });

  it("keeps the retry for a failure that might work next time", async () => {
    respond(429, '{"detail":"rate limited"}');
    const res = await transcribeAudio(new Blob(["x"]), {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("That recording couldn't be transcribed. Try again, or type it.");
  });

  it("sends keyterms as REPEATED form fields, never one JSON blob", async () => {
    /* Proven against the live API 2026-07-29: a JSON-stringified array is
       parsed as ONE keyword — brackets and all — so a real list blows the
       50-char per-keyword limit and the whole request 400s. This was the
       first live failure after the key was fixed. */
    let sent: FormData | null = null;
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent = init?.body as FormData;
      return { ok: true, json: async () => ({ text: "hi" }) };
    }) as unknown as typeof fetch;

    await transcribeAudio(new Blob(["x"]), { keyterms: ["Luke", "grilles"] });
    expect(sent!.getAll("keyterms")).toEqual(["Luke", "grilles"]);
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
