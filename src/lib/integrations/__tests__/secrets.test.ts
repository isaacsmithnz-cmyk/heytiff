import { generateTokenKey, open, parseTokenKey, seal, tokenKey } from "../secrets";

/* The seal is the reason a leaked database isn't a leaked accounting system,
   so the cases that matter here are the FAILURES: wrong key, tampered
   ciphertext, and a key of the wrong length being quietly accepted. Every one
   of them has to come back null — a `seal` that round-trips is the easy half. */

const KEY = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 9);

describe("parseTokenKey", () => {
  it("takes 32 bytes as hex, base64 and base64url", () => {
    const raw = Buffer.from("0123456789abcdef0123456789abcdef");
    expect(parseTokenKey(raw.toString("hex"))).toEqual(raw);
    expect(parseTokenKey(raw.toString("base64"))).toEqual(raw);
    expect(parseTokenKey(raw.toString("base64url"))).toEqual(raw);
  });

  it("refuses a key of the wrong length rather than padding it", () => {
    expect(parseTokenKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(parseTokenKey(Buffer.alloc(48, 0xff).toString("base64"))).toBeNull();
    // a 64-char string that isn't hex must not be read as 32 hex bytes
    expect(parseTokenKey("z".repeat(64))).toBeNull();
  });

  /* The one ambiguity between the accepted encodings: 64 characters that are
     all hex digits are also valid base64. It resolves to hex, always — the
     direction matters more than the choice, because a key that parsed one way
     today and the other way tomorrow can't open what it sealed. */
  it("reads a 64-char all-hex string as hex, deterministically", () => {
    const hexish = "a".repeat(64);
    expect(parseTokenKey(hexish)).toEqual(Buffer.from(hexish, "hex"));
    expect(parseTokenKey(hexish)).toEqual(parseTokenKey(hexish));
  });

  it("treats missing, blank and whitespace as no key at all", () => {
    expect(parseTokenKey(undefined)).toBeNull();
    expect(parseTokenKey(null)).toBeNull();
    expect(parseTokenKey("")).toBeNull();
    expect(parseTokenKey("   ")).toBeNull();
  });

  it("generates a key it will accept back", () => {
    expect(parseTokenKey(generateTokenKey())).toHaveLength(32);
  });
});

describe("tokenKey", () => {
  const saved = process.env.INTEGRATIONS_TOKEN_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.INTEGRATIONS_TOKEN_KEY;
    else process.env.INTEGRATIONS_TOKEN_KEY = saved;
  });

  it("is null when the deployment has none — never a default", () => {
    delete process.env.INTEGRATIONS_TOKEN_KEY;
    expect(tokenKey()).toBeNull();
  });

  it("reads the configured key", () => {
    process.env.INTEGRATIONS_TOKEN_KEY = KEY.toString("base64url");
    expect(tokenKey()).toEqual(KEY);
  });
});

describe("seal / open", () => {
  it("round-trips a refresh token", () => {
    const token = "refresh-token-value";
    expect(open(seal(token, KEY), KEY)).toBe(token);
  });

  it("never produces the same ciphertext twice for the same input", () => {
    // a fresh IV per seal: two identical tokens must not be correlatable
    expect(seal("same", KEY)).not.toBe(seal("same", KEY));
  });

  it("refuses the wrong key", () => {
    expect(open(seal("secret", KEY), OTHER)).toBeNull();
  });

  it("refuses tampered ciphertext", () => {
    const sealed = seal("secret", KEY);
    const parts = sealed.split(".");
    // flip a byte in the ciphertext; GCM's tag is what catches it
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64url");
    expect(open(parts.join("."), KEY)).toBeNull();
  });

  it("refuses a swapped auth tag", () => {
    const a = seal("one", KEY).split(".");
    const b = seal("two", KEY).split(".");
    expect(open([a[0], a[1], b[2], a[3]].join("."), KEY)).toBeNull();
  });

  it("refuses an unknown version prefix", () => {
    const sealed = seal("secret", KEY);
    expect(open("v2" + sealed.slice(2), KEY)).toBeNull();
  });

  it("refuses malformed, empty and missing input", () => {
    expect(open(null, KEY)).toBeNull();
    expect(open(undefined, KEY)).toBeNull();
    expect(open("", KEY)).toBeNull();
    expect(open("not-sealed", KEY)).toBeNull();
    expect(open("v1.a.b", KEY)).toBeNull();
    expect(open("v1.a.b.c.d", KEY)).toBeNull();
  });

  it("carries unicode through unharmed", () => {
    const token = "réfresh–tökén✓";
    expect(open(seal(token, KEY), KEY)).toBe(token);
  });
});
