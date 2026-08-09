/* The ask loop reaches Supabase at import time through its tool registry;
   nothing here calls a tool, so a stub client is enough to read the prompt. */
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { askSystemPrompt } from "@/lib/brain/ask";
import { systemPromptFor } from "@/lib/tiff/answer";
import { systemPrompt as noteSystemPrompt } from "@/lib/workboard/note-brain";
import { RECORD_IN_ENGLISH, RECORD_LANGUAGE, REPLY_IN_KIND } from "../policy";

/* REPLY IN KIND, RECORD IN ENGLISH — and the half of that rule which is
   easy to get wrong is the WIRING, not the words. A prompt that quietly
   stops carrying its rule fails in production as a Tagalog task title on
   somebody else's board, weeks later, with nothing to point at. So these
   pin which prompt carries which rule, and that no prompt carries both. */

const ANSWERING: [string, string][] = [
  ["kb general", systemPromptFor("general")],
  ["kb research", systemPromptFor("research")],
  ["kb miss", systemPromptFor("miss")],
  ["workspace ask", askSystemPrompt({ todayISO: "2026-08-09" })],
];

const ctx = {
  staff: [{ id: "1", fullName: "Luke Brennan" }],
  todayISO: "2026-08-09",
  debrief: false,
};

const RECORDING: [string, string][] = [
  ["site note", noteSystemPrompt({ ...ctx, debrief: false })],
  ["debrief", noteSystemPrompt({ ...ctx, debrief: true })],
];

describe("every prompt that answers a person answers in their language", () => {
  it.each(ANSWERING)("%s replies in kind", (_label, prompt) => {
    expect(prompt).toContain(REPLY_IN_KIND);
  });

  it.each(ANSWERING)("%s keeps Australian practice regardless of language", (_label, prompt) => {
    /* The language rule was carved OUT of "write in Australian English",
       and the practice half — metric, AS/NZS, our refrigerants — has to
       survive the split. */
    expect(prompt).toMatch(/AS\/NZS/);
    expect(prompt).toMatch(/metric/i);
  });

  it.each(ANSWERING)("%s is not also told to record in English", (_label, prompt) => {
    expect(prompt).not.toContain(RECORD_IN_ENGLISH);
  });
});

describe("every prompt that writes a record writes it for the whole crew", () => {
  it.each(RECORDING)("%s records in %s", (_label, prompt) => {
    expect(prompt).toContain(RECORD_IN_ENGLISH);
    expect(prompt).toContain(RECORD_LANGUAGE);
  });

  it.each(RECORDING)("%s does not also mirror the speaker's language", (_label, prompt) => {
    expect(prompt).not.toContain(REPLY_IN_KIND);
  });

  it.each(RECORDING)("%s keeps a name out of the translation", (_label, prompt) => {
    /* The one field that must NOT be translated: `resolveAssignee` matches
       the hint against the roster, and a translated name matches nobody. */
    expect(prompt).toMatch(/exactly as the note said it/);
  });

  it("says the due hint is written in English too", () => {
    /* It used to say only "in the note's own plain words", which is an
       instruction to keep the speaker's language on a field the whole board
       reads. */
    for (const [, prompt] of RECORDING) {
      expect(prompt).toMatch(/due_hint[\s\S]{0,80}in English/);
    }
  });
});

describe("the rules themselves", () => {
  it("names the workspace language once, so a change lands everywhere", () => {
    expect(RECORD_IN_ENGLISH).toContain(RECORD_LANGUAGE);
  });

  it("tells the answerer to mirror, and the recorder to translate", () => {
    expect(REPLY_IN_KIND).toMatch(/unless the question itself is clearly/);
    expect(RECORD_IN_ENGLISH).toMatch(/READ BY THE WHOLE CREW/);
  });

  it("defaults the answer to English rather than to whatever it mentions", () => {
    /* "u4 fault daikin vrv" — a fault code, a brand and a product line —
       came back as a page of Vietnamese in prod, because the rule's
       illustration was the only language it named and the query named
       none. An example in a rule about language IS the rule. */
    expect(REPLY_IN_KIND).toContain(RECORD_LANGUAGE);
    for (const language of [
      "Vietnamese",
      "Mandarin",
      "Chinese",
      "Spanish",
      "Arabic",
      "Tagalog",
      "Filipino",
    ]) {
      expect(REPLY_IN_KIND).not.toContain(language);
    }
  });
});
