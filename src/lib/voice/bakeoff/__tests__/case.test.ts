import { parseCase } from "../case";
import { scribeForm, mimeFor } from "../scribe";

const good = {
  audio: "van-01.m4a",
  conditions: "van idling, windows down",
  speaker: "Luke",
  language: "en",
  truth: "tell Luke we are at 36 Wyndham Street for job 337, condensate still to run",
  expect: { job: "337", site: "36 Wyndham Street", people: ["Luke"], terms: ["condensate"] },
};

describe("parseCase", () => {
  it("parses a complete case and takes its id from the filename", () => {
    const c = parseCase("van-01", good, "van-01.json");
    expect(c.id).toBe("van-01");
    expect(c.expect.job).toBe("337");
    expect(c.expect.people).toEqual(["Luke"]);
  });

  it("defaults language to English when unstated", () => {
    const { language, ...rest } = good;
    expect(language).toBe("en");
    expect(parseCase("x", rest).language).toBe("en");
  });

  it("names the file in every error, so a typo does not read as a vendor failure", () => {
    expect(() => parseCase("x", { ...good, truth: "" }, "van-01.json")).toThrow(/van-01\.json/);
  });

  it("rejects a case with no hard expectation", () => {
    // Terms alone cannot tell you whether the note would have routed.
    expect(() =>
      parseCase("x", { ...good, expect: { terms: ["condensate"] } }),
    ).toThrow(/hard expectation/);
  });

  it("rejects malformed expectation fields rather than ignoring them", () => {
    expect(() => parseCase("x", { ...good, expect: { job: 337 } })).toThrow(/expect\.job/);
    expect(() =>
      parseCase("x", { ...good, expect: { job: "337", people: "Luke" } }),
    ).toThrow(/expect\.people/);
  });

  it("rejects a non-object", () => {
    expect(() => parseCase("x", ["nope"])).toThrow(/JSON object/);
  });

  it("rejects an expectation the recording never contained", () => {
    // Unwinnable: every vendor fails it, for a reason that isn't the vendor's.
    expect(() =>
      parseCase("x", { ...good, expect: { ...good.expect, people: ["Mick"] } }),
    ).toThrow(/does not contain/);
  });

  it("catches the usual cause — the speaker named under people", () => {
    // Mick recorded it; he never says "Mick". That is the `speaker` field.
    expect(() =>
      parseCase("x", {
        ...good,
        speaker: "Mick",
        truth: "outdoor unit at 12 Karaka Road is tripping again, job 4471",
        expect: { job: "4471", people: ["Mick"] },
      }),
    ).toThrow(/speaker/);
  });

  it("accepts a case whose expectations are all genuinely in the transcript", () => {
    expect(() =>
      parseCase("x", {
        ...good,
        truth: "tell Luke we are at 36 Wyndham Street for job 337, condensate still to run",
      }),
    ).not.toThrow();
  });
});

describe("scribe request shape", () => {
  /* Pinned because wrong field names fail as a 422 that reads like bad audio.
     Verified against elevenlabs.io/docs/api-reference 2026-07-28. */
  it("sends the documented multipart fields", () => {
    const form = scribeForm({
      audio: new Uint8Array([1, 2, 3]),
      filename: "van-01.m4a",
      language: "en",
      keyterms: ["Luke", "condensate"],
    });
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("language_code")).toBe("en");
    expect(form.get("keyterms")).toBe('["Luke","condensate"]');
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("omits the language hint and keyterms when not supplied", () => {
    const form = scribeForm({ audio: new Uint8Array([1]), filename: "a.wav" });
    expect(form.get("language_code")).toBeNull();
    expect(form.get("keyterms")).toBeNull();
  });

  it("labels common recording formats correctly", () => {
    expect(mimeFor("van-01.m4a")).toBe("audio/mp4");
    expect(mimeFor("note.webm")).toBe("audio/webm");
    expect(mimeFor("what.xyz")).toBe("application/octet-stream");
  });
});
