/* Email to Tiff, read (28 October 2026): what Tiff is asked, what of her
   answer is believed, what she says over the card, and the words a ServiceM8
   job is made of. Truecut Building's real tender for 40 Westbourne Street,
   Stanmore is the example. */
import { EMAIL_JOB_SCHEMA, dueWords, emailJobPrompt, jobDescriptionOf, parseEmailJobRead, threadTitleOf, tiffSays, type EmailProposal } from "../proposal";

const raw = {
  isJob: true,
  notJobWhy: "",
  summary: "Truecut Building want an itemised quote for the air conditioning in a tender for alterations and additions at 40 Westbourne Street, Stanmore.",
  client: "Truecut Building",
  contactFirst: "Matt",
  contactLast: "Glass",
  contactMobile: "0412 345 678",
  contactPhone: "",
  contactEmail: "matt@truecut.example",
  site: "40 Westbourne Street, Stanmore NSW 2048",
  due: "2026-11-07",
  scope: ["Modify the existing underfloor AC", "Extend it to the attic", "Relocate outdoor units beneath deck on plinths"],
  excluded: ["The secondary dwelling"],
};

it("asks for every field, none optional, and tells Tiff who 'we' are and who forwarded it", () => {
  expect([...EMAIL_JOB_SCHEMA.required].sort()).toEqual(Object.keys(EMAIL_JOB_SCHEMA.properties).sort());
  const ask = emailJobPrompt({ business: "Diamond Air Solutions", forwarder: "Isaac Smith", today: "2026-10-30" });
  expect(ask).toContain("Never Diamond Air Solutions, and never the person who forwarded it");
  expect(ask).toContain("Isaac Smith forwarded you the email");
  expect(ask).toContain("Today is 2026-10-30");
});

it("believes a read only as far as it holds up", () => {
  const read = parseEmailJobRead(raw);
  expect(read).toMatchObject({ isJob: true, client: "Truecut Building", site: "40 Westbourne Street, Stanmore NSW 2048", due: "2026-11-07" });
  expect(read.contact).toEqual({ first: "Matt", last: "Glass", mobile: "0412 345 678", phone: "", email: "matt@truecut.example" });
  const bad = parseEmailJobRead({ ...raw, isJob: "yes", due: "7/11/2026", contactEmail: "not an address", scope: ["  ", 4, "Ducting"] });
  expect(bad).toMatchObject({ isJob: false, due: "", scope: ["Ducting"] });
  expect(bad.contact.email).toBe("");
  expect(parseEmailJobRead(null)).toMatchObject({ isJob: false, client: "", scope: [] });
});

it("says a due date the way it's said here", () => {
  expect(dueWords("2026-11-07")).toBe("Saturday 7 November");
  expect(dueWords("")).toBe("");
});

it("writes the job's description from the scope as written, what's excluded and where it came from", () => {
  const d = jobDescriptionOf(parseEmailJobRead(raw), { name: "Isaac Smith", at: "Thursday 30 October" });
  expect(d).toBe(
    [
      "Scope:",
      "- Modify the existing underfloor AC",
      "- Extend it to the attic",
      "- Relocate outdoor units beneath deck on plinths",
      "",
      "Excluded:",
      "- The secondary dwelling",
      "",
      "Quote due Saturday 7 November.",
      "",
      "From Matt Glass's email (Truecut Building), forwarded to Tiff by Isaac Smith on Thursday 30 October.",
    ].join("\n")
  );
  const long = jobDescriptionOf(parseEmailJobRead({ ...raw, scope: Array.from({ length: 40 }, () => "x".repeat(400)) }), { name: null, at: "today" });
  expect(long.length).toBeLessThanOrEqual(4000);
});

it("names the thread after the email, without its Fw:", () => {
  expect(threadTitleOf("Fw: RE: Tender – 40 Westbourne Street, Stanmore", null)).toBe("Tender – 40 Westbourne Street, Stanmore");
  expect(threadTitleOf("", parseEmailJobRead(raw))).toBe("New job, 40 Westbourne Street, Stanmore NSW 2048");
});

describe("what Tiff says over the card", () => {
  const p = (over: Partial<EmailProposal> = {}): EmailProposal => ({ ...parseEmailJobRead(raw), clientMatch: null, siteMatch: null, ...over });

  it("says a client already here, and a new site for a builder", () => {
    const words = tiffSays(p({ clientMatch: { uuid: "c1", name: "Truecut Building", builder: true } }), null);
    expect(words).toContain("It's due Saturday 7 November.");
    expect(words).toContain("Truecut Building is already a client; the site is new for them.");
  });

  it("says a new client is added, an email that isn't work, and one she couldn't read", () => {
    expect(tiffSays(p(), null)).toContain("Truecut Building aren't a client yet; Create job adds them.");
    expect(tiffSays(p({ isJob: false, notJobWhy: "A supplier's invoice." }), null)).toBe(
      "This doesn't read as a request for work (A supplier's invoice), so I haven't proposed a job. Make one from New › Job if it is."
    );
    expect(tiffSays(null, "Tiff was busy.")).toBe("I couldn't read this one: Tiff was busy. Forward it again, or make the job from New › Job.");
  });
});
