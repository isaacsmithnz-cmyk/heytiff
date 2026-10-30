/* The Inbox's rows (30 October 2026), said from the email's own row. */
import { emailWords, inboxHeadLine, inboxLine, inboxOf, inboxWord, type InboxEmail, type InboxRowIn } from "../inbox";
import type { EmailProposal } from "../proposal";

const proposal = (over: Partial<EmailProposal> = {}) =>
  ({
    isJob: true,
    aboutJob: false,
    jobNumbers: [],
    notJobWhy: "",
    summary: "",
    client: "JT Construct Pty Ltd",
    contact: { first: "Shaheer", last: "Khan", mobile: "", phone: "", email: "" },
    site: "2 Krui Street, Fairlight",
    due: "",
    scope: [],
    excluded: [],
    clientMatch: null,
    siteMatch: null,
    jobs: [],
    ...over,
  }) as EmailProposal;

const row = (over: Partial<InboxRowIn> = {}): InboxRowIn => ({
  id: "e1",
  subject: "Fwd: Request for quotation",
  received_at: "2026-10-29T08:48:00Z",
  state: "read",
  proposal: proposal(),
  sender_sub: "auth0|isaac",
  jobNumber: null,
  ...over,
});

const names = new Map([
  ["auth0|isaac", "Isaac"],
  ["auth0|alex", "Alex"],
]);

describe("the rows", () => {
  it("says who it's from and who forwarded it, newest first, without the Fwd:", () => {
    const [a, b] = inboxOf(
      [row({ id: "old", received_at: "2026-10-20T00:00:00Z", sender_sub: "auth0|alex" }), row({ id: "new" })],
      "auth0|isaac",
      names
    );
    expect(a).toMatchObject({ id: "new", subject: "Request for quotation", from: "Shaheer Khan", by: "Isaac", mine: true, kind: "new" });
    expect(b).toMatchObject({ id: "old", by: "Alex", mine: false });
  });

  it("names the company when there's no contact, and no one when it can't tell", () => {
    const [a] = inboxOf([row({ proposal: proposal({ contact: { first: "", last: "", mobile: "", phone: "", email: "" } }) })], null, names);
    expect(a!.from).toBe("JT Construct Pty Ltd");
    const [b] = inboxOf([row({ proposal: null, sender_sub: null, state: "failed" })], null, names);
    expect(b).toMatchObject({ from: null, by: null, kind: "none" });
  });

  it("never shows a refused email", () => {
    expect(inboxOf([row({ state: "refused" })], null, names)).toEqual([]);
  });

  /* Krui Street, 29 October 2026: the failed read sat beside the one that worked */
  it("drops a forward that couldn't be read once the same person's later forward of it was", () => {
    const failed = row({ id: "failed", state: "failed", received_at: "2026-10-29T06:03:00Z", proposal: null });
    expect(inboxOf([row({ id: "worked" }), failed], "auth0|isaac", names).map((e) => e.id)).toEqual(["worked"]);
  });

  it("keeps a failed forward when nothing later read it, or someone else's did", () => {
    const failed = row({ id: "failed", state: "failed", received_at: "2026-10-29T06:03:00Z", proposal: null });
    expect(inboxOf([failed], "auth0|isaac", names).map((e) => e.id)).toEqual(["failed"]);
    expect(inboxOf([row({ id: "alex", sender_sub: "auth0|alex" }), failed], "auth0|isaac", names).map((e) => e.id)).toEqual(["alex", "failed"]);
    expect(inboxOf([row({ id: "earlier", received_at: "2026-10-29T01:00:00Z" }), failed], "auth0|isaac", names).map((e) => e.id)).toEqual(["failed", "earlier"]);
  });
});

describe("where it stands", () => {
  const e = (over: Partial<InboxEmail>): InboxEmail => ({ id: "e", subject: "s", from: null, by: null, mine: false, at: 0, state: "read", jobNumber: null, forJob: null, kind: "new", ...over });

  it("waits, in amber, only while it's read and nobody has decided", () => {
    expect(inboxWord(e({}))).toEqual({ tone: "look", word: "Not made yet", waiting: true });
    expect(inboxWord(e({ kind: "existing" }))).toEqual({ tone: "look", word: "Not added yet", waiting: true });
    expect(inboxWord(e({ kind: "none" }))).toEqual({ tone: "info", word: "Not a job", waiting: false });
  });

  it("says what became of it", () => {
    expect(inboxWord(e({ state: "made", jobNumber: "3471" })).word).toBe("Job 3471 made");
    expect(inboxWord(e({ state: "made" })).word).toBe("Job made");
    expect(inboxWord(e({ state: "filed", jobNumber: "3390" }))).toEqual({ tone: "good", word: "Added to job 3390", waiting: false });
    expect(inboxWord(e({ state: "not_a_job" })).tone).toBe("info");
    expect(inboxWord(e({ state: "failed" }))).toEqual({ tone: "wrong", word: "Couldn't be read", waiting: false });
    expect(inboxWord(e({ state: "received" })).word).toBe("Being read");
  });
});

describe("the grey lines", () => {
  const now = new Date(2026, 9, 30, 21, 0).getTime();
  const yesterday = new Date(2026, 9, 29, 19, 48).getTime();

  it("says it on a row", () => {
    expect(inboxLine({ from: "Shaheer Khan", by: "Isaac", mine: true, at: yesterday }, now)).toBe("From Shaheer Khan, forwarded by you yesterday");
    expect(inboxLine({ from: "Matt Glass", by: "Alex", mine: false, at: yesterday }, now)).toBe("From Matt Glass, forwarded by Alex yesterday");
    expect(inboxLine({ from: null, by: "Alex", mine: false, at: yesterday }, now)).toBe("Forwarded by Alex yesterday");
    expect(inboxLine({ from: null, by: null, mine: false, at: yesterday }, now)).toBe("Forwarded yesterday");
  });

  it("says it in full over an open email", () => {
    expect(inboxHeadLine({ by: "Isaac", mine: true, at: yesterday }, proposal(), now)).toBe("From Shaheer Khan at JT Construct Pty Ltd, forwarded by you yesterday at 7:48 pm");
    expect(inboxHeadLine({ by: "Alex", mine: false, at: new Date(2026, 9, 30, 14, 12).getTime() }, proposal({ client: "" }), now)).toBe("From Shaheer Khan, forwarded by Alex today at 2:12 pm");
    expect(inboxHeadLine({ by: null, mine: false, at: yesterday }, null, now)).toBe("Forwarded yesterday at 7:48 pm");
  });
});

describe("the builder's own email", () => {
  const KRUI =
    "---------- Forwarded message ---------\nFrom: Shaheer Khan <shaheer@jtconstruct.com.au>\nDate: Fri, 9 Oct 2026 at 13:02\nSubject: Request for quotation – 2 Krui Street, Fairlight - Air\nconditioning and ventilation\nTo: <isaac@diamondairsolutions.com.au>\n\n\nHi,\n\n" +
    "Please provide an itemised quotation for your trade using the attached\nscope and relevant plans.\n\n" +
    "Tender link: 260917 Tender Issue\n<https://watershedmanly-my.sharepoint.com/:f:/g/personal/x/abc?e=1>\n\n" +
    "*Quotation required by:* 21/10/26\n\nPlease include:\n\n   -\n\n   Price excluding GST, GST and total including GST.\n   -\n\n   Labour, materials, plant and provisional allowances separately where\n   practical.\n\nRegards,\nShaheer";

  it("takes the forward's header off, keeps when it was sent, and reads as written", () => {
    const { words, sent } = emailWords(KRUI);
    expect(sent).toBe("Fri, 9 Oct 2026 at 13:02");
    expect(words).toBe(
      "Hi,\n\nPlease provide an itemised quotation for your trade using the attached scope and relevant plans.\n\nTender link: 260917 Tender Issue\n\nQuotation required by: 21/10/26\n\nPlease include:\n\n- Price excluding GST, GST and total including GST.\n- Labour, materials, plant and provisional allowances separately where practical.\n\nRegards,\nShaheer"
    );
  });

  it("leaves an email that wasn't forwarded as it is, and nothing as nothing", () => {
    expect(emailWords("Hi,\n\nPlans attached.")).toEqual({ words: "Hi,\n\nPlans attached.", sent: null });
    expect(emailWords(null)).toEqual({ words: "", sent: null });
  });
});
