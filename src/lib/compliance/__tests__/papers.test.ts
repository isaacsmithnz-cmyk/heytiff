/* Compliance on a job — the pure rules the chooser, the job's rows, the send
   footer and the actions all read. What these pin: a key the browser hands
   back is only ever one of ours, a paper that can't be given says why, data
   is printed as its owner spells it, the trade tickets lead, and a file
   leaves under the name of what it is. */

import {
  EMAIL_MAX_TO,
  attachmentName,
  choiceBlock,
  choiceFacts,
  choiceStateWord,
  defaultMessage,
  defaultSubject,
  holdersOf,
  isEmailAddress,
  licenceTypes,
  paperKey,
  paperMeta,
  paperSendable,
  paperState,
  paperStateLine,
  readAddresses,
  readPaperKey,
  sentNote,
  splitSendKeys,
  uniqueNames,
  withExtension,
  type JobPaper,
  type PaperChoice,
} from "../papers";

const TODAY = "2026-09-23";

const choice = (over: Partial<PaperChoice> = {}): PaperChoice => ({
  key: "c:1",
  kind: "company",
  name: "Public liability",
  person: null,
  issuer: "QBE",
  expiresOn: "2027-06-30",
  state: "ok",
  files: 1,
  booked: false,
  onJob: false,
  ...over,
});

const paper = (over: Partial<JobPaper> = {}): JobPaper => ({
  id: "p1",
  kind: "company",
  name: "Public liability",
  person: null,
  issuer: "QBE",
  expiresOn: "2027-06-30",
  state: "ok",
  renewed: false,
  files: [{ id: "d1", fileName: "coc.pdf", mimeType: "application/pdf", sizeBytes: 1000, url: "https://x/y" }],
  addedBy: "Isaac Smith",
  addedAt: "2026-09-23T00:00:00Z",
  manage: true,
  ...over,
});

describe("keys", () => {
  it("round-trips a paper key, and reads nothing else as one", () => {
    expect(readPaperKey(paperKey("company", "abc-1"))).toEqual({ kind: "company", id: "abc-1" });
    expect(readPaperKey(paperKey("staff", "lic-9"))).toEqual({ kind: "staff", id: "lic-9" });
    for (const junk of ["x:abc", "c:", "c:has space", "l:a/b", 7, null, undefined, "c:" + "a".repeat(81)])
      expect(readPaperKey(junk)).toBeNull();
  });

  it("splits ticks into the three lists the email takes, once each, dropping anything else", () => {
    expect(splitSendKeys(["p:1", "d:2", "f:3", "p:1", "x:9", "p:bad id", "f:4"])).toEqual({
      papers: ["1"],
      documents: ["2"],
      files: ["3", "4"],
    });
  });
});

describe("what a choice says", () => {
  it("counts down inside the warning window and not before", () => {
    expect(paperState("2026-10-05", TODAY, 30)).toBe("warn");
    expect(paperState("2027-06-30", TODAY, 30)).toBe("ok");
    expect(paperState("2026-09-22", TODAY, 30)).toBe("bad");
    expect(paperState(null, TODAY, 30)).toBe("none");
  });

  it("offers no box for a paper that can't be given, and says why", () => {
    expect(choiceBlock(choice())).toBeNull();
    expect(choiceBlock(choice({ onJob: true }))).toBe("On this job");
    expect(choiceBlock(choice({ files: 0 }))).toBe("No certificate on file");
    expect(choiceBlock(choice({ kind: "staff", files: 0 }))).toBe("No licence on file");
    expect(choiceBlock(choice({ state: "bad" }))).toBe("Expired");
    /* on the job outranks the rest — it is already where it was going */
    expect(choiceBlock(choice({ onJob: true, state: "bad" }))).toBe("On this job");
  });

  it("ends on the state word, coloured only where it means something", () => {
    expect(choiceStateWord(choice(), TODAY)).toEqual({ word: "Valid", tone: "ok" });
    expect(choiceStateWord(choice({ state: "warn", expiresOn: "2026-10-05" }), TODAY)).toEqual({
      word: "Expires in 12 days",
      tone: "warn",
    });
    expect(choiceStateWord(choice({ state: "bad" }), TODAY)).toEqual({ word: "Expired", tone: "bad" });
    expect(choiceStateWord(choice({ state: "none", expiresOn: null }), TODAY)).toEqual({ word: "No expiry", tone: "mute" });
    expect(choiceStateWord(choice({ files: 0 }), TODAY).tone).toBe("mute");
  });

  it("prints an issuer as its owner spells it — icare is lower case on its own certificate", () => {
    expect(choiceFacts(choice({ issuer: "icare", expiresOn: "2027-02-28" }))).toBe("icare, to 28 Feb 2027");
    /* a line that opens on our own words takes the capital */
    expect(choiceFacts(choice({ issuer: null }))).toBe("To 30 Jun 2027");
    expect(choiceFacts(choice({ issuer: null, expiresOn: null }))).toBe("");
  });
});

describe("a paper on the job", () => {
  it("says whose or whose-issued, how long, and who put it there", () => {
    expect(paperMeta(paper())).toBe("QBE, to 30 Jun 2027, added by Isaac Smith");
    expect(paperMeta(paper({ kind: "staff", name: "ARC licence", person: "Dane Whitmore", issuer: "ARC" }))).toBe(
      "Dane Whitmore, to 30 Jun 2027, added by Isaac Smith"
    );
    expect(paperMeta(paper({ issuer: null, addedBy: null }))).toBe("To 30 Jun 2027");
  });

  it("says out loud what needs doing — expired outranks renewed, and all is well says nothing", () => {
    expect(paperStateLine(paper(), TODAY)).toBeNull();
    expect(paperStateLine(paper({ state: "none", expiresOn: null }), TODAY)).toBeNull();
    expect(paperStateLine(paper({ renewed: true }), TODAY)).toEqual({ word: "Renewed since it was added", tone: "warn" });
    expect(paperStateLine(paper({ state: "warn", expiresOn: "2026-10-05" }), TODAY)).toEqual({
      word: "Expires in 12 days",
      tone: "warn",
    });
    expect(paperStateLine(paper({ state: "bad", renewed: true }), TODAY)).toEqual({ word: "Expired", tone: "bad" });
  });

  it("can be ticked to send only with a file this viewer may open, and only while in date", () => {
    expect(paperSendable(paper())).toBe(true);
    expect(paperSendable(paper({ state: "bad" }))).toBe(false);
    expect(paperSendable(paper({ files: [] }))).toBe(false);
    /* a colleague's licence, for someone who may not open it */
    expect(paperSendable(paper({ files: [{ ...paper().files[0], url: null }] }))).toBe(false);
  });
});

describe("the chooser's order", () => {
  const staff = [
    choice({ key: "l:1", kind: "staff", name: "Driver’s licence", person: "Dane Whitmore", booked: true }),
    choice({ key: "l:2", kind: "staff", name: "Working at heights", person: "Kai Lindqvist" }),
    choice({ key: "l:3", kind: "staff", name: "ARC licence", person: "Troy Porter" }),
    choice({ key: "l:4", kind: "staff", name: "arc licence", person: "Dane Whitmore", booked: true }),
    choice({ key: "l:5", kind: "staff", name: "Contractor licence", person: "Kai Lindqvist" }),
    choice({ key: "l:6", kind: "staff", name: "Asbestos awareness", person: "Troy Porter" }),
    choice({ key: "l:7", kind: "staff", name: "White card", person: "Kai Lindqvist" }),
  ];

  it("leads with the trade tickets, puts the driver licence last of the named, then everything custom", () => {
    expect(licenceTypes(staff)).toEqual([
      "ARC licence",
      "Contractor licence",
      "White card",
      "Driver’s licence",
      "Asbestos awareness",
      "Working at heights",
    ]);
  });

  it("holds one type however it was typed, with the people booked on the job first", () => {
    expect(holdersOf(staff, "ARC licence").map((c) => c.person)).toEqual(["Dane Whitmore", "Troy Porter"]);
    expect(holdersOf(staff, "driver's licence").map((c) => c.key)).toEqual(["l:1"]);
  });
});

describe("the email", () => {
  it("reads addresses the way people paste them, and says which aren't", () => {
    expect(readAddresses("jane@abc.com.au, Mark@abc.com.au;\nnot-an-address  jane@ABC.com.au")).toEqual({
      ok: ["jane@abc.com.au", "Mark@abc.com.au"],
      bad: ["not-an-address"],
    });
    expect(readAddresses("  ")).toEqual({ ok: [], bad: [] });
    expect(isEmailAddress("a@b.co")).toBe(true);
    for (const bad of ["a@b", "a b@c.com", "<a@b.com>", "a@b.c", "a,b@c.com"]) expect(isEmailAddress(bad)).toBe(false);
    expect(EMAIL_MAX_TO).toBeGreaterThan(1);
  });

  it("starts with the job's number and street, and the sender's name", () => {
    expect(defaultSubject({ number: "2380", address: "12 Smith St" })).toBe("Documents for job 2380, 12 Smith St");
    expect(defaultSubject({ number: null, address: null })).toBe("Documents for your job");
    expect(defaultMessage("Isaac Smith", "Diamond Air")).toBe(
      "Hi,\n\nPlease find our documents for this job attached.\n\nKind regards,\nIsaac Smith\nDiamond Air"
    );
    expect(defaultMessage(null, null)).toBe("Hi,\n\nPlease find our documents for this job attached.");
  });

  it("names a paper's file for what it is, not what the phone called it", () => {
    const pdf = { fileName: "IMG_2031.pdf", mimeType: "application/pdf" };
    expect(attachmentName({ name: "Public liability", person: null }, pdf, 0, 1)).toBe("Public liability.pdf");
    expect(attachmentName({ name: "ARC licence", person: "Dane Whitmore" }, { fileName: "front.HEIC", mimeType: "image/heic" }, 1, 2)).toBe(
      "ARC licence, Dane Whitmore 2.heic"
    );
    /* nothing that could become a path, whatever the credential is called */
    expect(attachmentName({ name: "Cover: A/B <1>", person: null }, pdf, 0, 1)).toBe("Cover A B 1.pdf");
  });

  it("gives a ServiceM8 name its extension, and never says one name twice", () => {
    expect(withExtension("Quote #2380", "application/pdf")).toBe("Quote #2380.pdf");
    expect(withExtension("site.jpg", "image/jpeg")).toBe("site.jpg");
    expect(uniqueNames(["plan.pdf", "Plan.pdf", "plan.pdf", "notes"])).toEqual(["plan.pdf", "Plan 2.pdf", "plan 3.pdf", "notes"]);
  });

  it("records the send in the diary in words", () => {
    expect(sentNote(["Public liability", "ARC licence (Dane Whitmore)"], ["jane@abc.com.au"])).toBe(
      "Emailed Public liability and ARC licence (Dane Whitmore) to jane@abc.com.au."
    );
  });
});
