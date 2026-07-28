/* A bake-off case: one recording, the words a human actually heard in it, and
   what has to survive transcription for the note to route.

   Cases are read from disk rather than declared in code because they are
   evidence, not fixtures — recorded by real techs in real conditions, added one
   at a time from the field, and never committed (they carry voices, client
   names and addresses). Parsing is strict and the errors name the file: a case
   with a typo'd field silently scoring zero would read as a vendor failure. */

import { findPhrase, findSite, type Expectations } from "./score";

export type BakeoffCase = {
  /** Stable id — the case filename without its extension. */
  id: string;
  /** Audio filename, resolved against the audio directory. */
  audio: string;
  /** Free text: "van idling, windows down", "roof, wind", "plant room". The
      reason a case failed is usually written here. */
  conditions: string;
  /** Who spoke, so a consistently-misheard voice is visible in the report. */
  speaker: string;
  /** ISO-639-1 of the language actually spoken. Sent as a HINT only — Scribe
      auto-detects regardless, and a case in Spanish is a real test of that. */
  language: string;
  /** The words a human typed out of this recording. Ground truth, made once,
      kept forever: it is what makes re-testing a future vendor an afternoon. */
  truth: string;
  expect: Expectations;
};

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function stringField(raw: Record<string, unknown>, key: string, file: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") fail(file, `"${key}" must be a non-empty string`);
  return v.trim();
}

function stringArray(raw: Record<string, unknown>, key: string, file: string): string[] | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    fail(file, `"expect.${key}" must be an array of strings`);
  }
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

/** Parse one case file. `id` comes from the filename so two cases can't collide
    on a field someone forgot to change after copy-pasting. */
export function parseCase(id: string, json: unknown, file = id): BakeoffCase {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    fail(file, "must be a JSON object");
  }
  const raw = json as Record<string, unknown>;

  const expectRaw = raw.expect;
  if (expectRaw === null || typeof expectRaw !== "object" || Array.isArray(expectRaw)) {
    fail(file, '"expect" must be an object');
  }
  const exp = expectRaw as Record<string, unknown>;

  const job = exp.job;
  if (job !== undefined && typeof job !== "string") fail(file, '"expect.job" must be a string');
  const site = exp.site;
  if (site !== undefined && typeof site !== "string") fail(file, '"expect.site" must be a string');

  const expect: Expectations = {
    job: typeof job === "string" && job.trim() !== "" ? job.trim() : undefined,
    site: typeof site === "string" && site.trim() !== "" ? site.trim() : undefined,
    people: stringArray(exp, "people", file),
    terms: stringArray(exp, "terms", file),
  };

  const hardChecks =
    (expect.job ? 1 : 0) + (expect.site ? 1 : 0) + (expect.people?.length ?? 0);
  if (hardChecks === 0) {
    fail(
      file,
      'needs at least one hard expectation ("job", "site" or "people") — a case with only ' +
        '"terms" cannot tell you whether the note would have routed, which is the whole question',
    );
  }

  const truth = stringField(raw, "truth", file);
  assertExpectationsAreInTruth(truth, expect, file);

  return {
    id,
    audio: stringField(raw, "audio", file),
    conditions: stringField(raw, "conditions", file),
    speaker: stringField(raw, "speaker", file),
    language: typeof raw.language === "string" && raw.language.trim() !== ""
      ? raw.language.trim()
      : "en",
    truth,
    expect,
  };
}

/* An expectation the recording never contained is UNWINNABLE — every vendor
   fails it, for a reason that has nothing to do with the vendor. That is the
   worst thing this harness could get wrong, because it reads as evidence.

   The commonest way to write one: naming the SPEAKER under `people` when they
   never said their own name. "Mick, on a roof" is the `speaker` field; it only
   belongs in `people` if the words "tell Mick" are actually in the audio.

   Checked against the human transcript, so it costs nothing at run time and
   fails while the case is being written, when it can still be fixed. */
export function assertExpectationsAreInTruth(
  truth: string,
  expect: Expectations,
  file: string,
): void {
  const missing: string[] = [];
  const check = (label: string, matches: { hit: boolean }[]) => {
    if (!matches.every((m) => m.hit)) missing.push(label);
  };

  if (expect.job) check(`job "${expect.job}"`, [findPhrase(truth, expect.job)]);
  if (expect.site) check(`site "${expect.site}"`, findSite(truth, expect.site));
  for (const person of expect.people ?? []) {
    check(`person "${person}"`, [findPhrase(truth, person)]);
  }
  for (const term of expect.terms ?? []) {
    check(`term "${term}"`, [findPhrase(truth, term)]);
  }

  if (missing.length > 0) {
    fail(
      file,
      `expects ${missing.join(", ")}, but the transcript does not contain ` +
        `${missing.length === 1 ? "it" : "them"}. An expectation that isn't in the audio ` +
        `fails every vendor for a reason that has nothing to do with the vendor. ` +
        `(Naming the speaker under "people" when they never said their own name is the usual cause — ` +
        `that belongs in "speaker".)`,
    );
  }
}
