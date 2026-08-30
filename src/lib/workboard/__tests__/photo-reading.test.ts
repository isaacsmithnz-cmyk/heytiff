import {
  READING_SCHEMA,
  READ_PROMPT,
  isSendableImage,
  parseReading,
} from "@/lib/workboard/photo-reading";
import { PHOTO_SUBJECTS } from "@/lib/workboard/photo-subjects";

/* A SCHEMA CONSTRAINS SHAPE, NOT SENSE. Everything the model returns is
   re-checked here before it reaches the bank, and these are the shapes that
   actually turn up. */

describe("the reading schema", () => {
  /* THE BUG THIS PINS COST A FULL PROD FAILURE ONCE: `maxItems` on an array
     is rejected outright by the structured-output validator, and every call
     400s — surfacing only as "couldn't read that photo". The cap belongs to
     the prompt and to parseReading, not to the schema. */
  it("carries no maxItems anywhere", () => {
    expect(JSON.stringify(READING_SCHEMA)).not.toContain("maxItems");
  });

  /* A photo the model cannot place must be able to say so. Forced to choose
     it picks the least-wrong option, and the filter fills with confident
     nonsense. */
  it("lets the subject be null as well as one of the closed set", () => {
    const subject = READING_SCHEMA.properties.subject;
    expect(subject.anyOf).toContainEqual({ type: "null" });
    expect(subject.anyOf[0]).toEqual({ type: "string", enum: [...PHOTO_SUBJECTS] });
  });

  it("asks for the transcription, not just the labels", () => {
    expect(READING_SCHEMA.required).toContain("text");
    expect(READING_SCHEMA.properties.text).toEqual({ type: "string" });
  });
});

describe("the prompt", () => {
  /* Two copies of a vocabulary is one copy and a bug waiting for somebody to
     edit the wrong one, so the prompt is BUILT from the subject list. */
  it("offers every subject, with its meaning", () => {
    for (const s of PHOTO_SUBJECTS) expect(READ_PROMPT).toContain(`- ${s}: `);
  });

  /* The cheapest place to not have data is to never write it down. This
     collection gets shown to OTHER clients. */
  it("forbids transcribing anything that identifies a person", () => {
    for (const forbidden of ["face", "number plate", "name"])
      expect(READ_PROMPT.toLowerCase()).toContain(forbidden);
  });
});

describe("parseReading", () => {
  const good = JSON.stringify({
    subject: "dataplate",
    tags: ["Mitsubishi", "R32", "outdoor unit"],
    caption: "Rating label on the outdoor unit",
    text: "MODEL PUZ-M125VKA2-A  SERIAL 0081  230V",
  });

  it("keeps a well-formed reading, lowercasing the tags", () => {
    expect(parseReading(good)).toEqual({
      subject: "dataplate",
      tags: ["mitsubishi", "r32", "outdoor unit"],
      caption: "Rating label on the outdoor unit",
      ocrText: "MODEL PUZ-M125VKA2-A  SERIAL 0081  230V",
    });
  });

  /* The transcription is NOT lowercased or normalised — a model number is a
     string off a label and must survive verbatim. */
  it("leaves the transcription exactly as printed", () => {
    expect(parseReading(good)?.ocrText).toContain("PUZ-M125VKA2-A");
  });

  it("enforces the six-tag cap the schema is not allowed to", () => {
    const many = JSON.stringify({
      subject: "ductwork",
      tags: ["a", "b", "c", "d", "e", "f", "g", "h"],
      caption: "",
      text: "",
    });
    expect(parseReading(many)?.tags).toHaveLength(6);
  });

  it("drops duplicate tags rather than counting them twice", () => {
    const dupes = JSON.stringify({
      subject: "ductwork",
      tags: ["flexible", "Flexible", "FLEXIBLE", "rigid"],
      caption: "",
      text: "",
    });
    expect(parseReading(dupes)?.tags).toEqual(["flexible", "rigid"]);
  });

  /* A subject outside the closed set is not a reason to throw the reading
     away — the caption and the transcription are still worth banking. */
  it("keeps the rest when the subject is not one of ours", () => {
    const odd = JSON.stringify({
      subject: "condenser",
      tags: ["roof"],
      caption: "A condenser on a roof",
      text: "DAIKIN",
    });
    expect(parseReading(odd)).toEqual({
      subject: null,
      tags: ["roof"],
      caption: "A condenser on a roof",
      ocrText: "DAIKIN",
    });
  });

  it("survives every field being the wrong type", () => {
    const junk = JSON.stringify({ subject: 7, tags: "ductwork", caption: null, text: [] });
    expect(parseReading(junk)).toEqual({ subject: null, tags: [], caption: "", ocrText: "" });
  });

  /* Null ONLY when it was not even JSON — that is the caller's signal to
     record a looked-at-but-unplaced reading rather than to retry. */
  it("returns null only when the answer was not JSON at all", () => {
    expect(parseReading("I'm sorry, I can't help with that.")).toBeNull();
    expect(parseReading("")).toBeNull();
    expect(parseReading("null")).toBeNull();
  });

  it("bounds a runaway transcription without truncating a real label", () => {
    const long = JSON.stringify({ subject: null, tags: [], caption: "", text: "x".repeat(9000) });
    expect(parseReading(long)?.ocrText).toHaveLength(4000);
  });
});

describe("isSendableImage", () => {
  /* AVIF is a photo we hold and can render, and it is NOT one of the four the
     image block takes — 399 of them live in the account. It reaches Claude
     only because sharp re-encodes it; this predicate is what keeps it from
     being sent under a type it isn't when sharp is unavailable. */
  it("admits the four the image block takes, and not AVIF", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif"])
      expect(isSendableImage(m)).toBe(true);
    expect(isSendableImage("image/avif")).toBe(false);
    expect(isSendableImage("application/pdf")).toBe(false);
    expect(isSendableImage(null)).toBe(false);
  });
});
