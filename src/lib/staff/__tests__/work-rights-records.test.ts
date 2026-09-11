import type { StoredDocument } from "@/lib/documents/query";
import {
  WORK_RIGHTS_LOCKED,
  buildWorkRightsCheckRow,
  checkAddedText,
  checkDocuments,
  checkEvent,
  checkFacts,
  checkHeadline,
  checkState,
  checkSubline,
  currentCheck,
  looseCheckDocuments,
  previousChecks,
  type WorkRightsRecord,
} from "../work-rights-records";

/* The pure half of a person's right-to-work checks.

   THE ONE RULE THIS FILE EXISTS TO PROTECT is the one that is INVERTED from
   its two siblings. A licence's current term is the latest EXPIRY; a person's
   current work-rights record is the latest CHECK. Status goes backwards — a
   substantive visa lapses to a bridging visa, full rights become conditional —
   and sorting by expiry would let a stale record with a longer date outrank a
   check made this morning saying the person can no longer work. Anyone
   "tidying up" the three modules into one shape will break exactly that, so it
   is tested first and named loudly. */

const WARN = 30; // the org window every fixture here assumes
const TODAY = "2026-07-24";

const rec = (over: Partial<WorkRightsRecord> = {}): WorkRightsRecord => ({
  id: "C1",
  staffProfileId: "S1",
  status: "Full working rights (visa)",
  visaType: "482 Temporary Skill Shortage",
  hoursCondition: "No work limitation",
  expiresOn: "2028-03-04",
  checkedOn: "2026-02-03",
  source: "vevo",
  documentId: null,
  createdAt: "2026-02-03T00:00:00.000Z",
  ...over,
});

const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
  id: "D1",
  kind: "work_rights",
  fileName: "vevo.pdf",
  mimeType: "application/pdf",
  sizeBytes: 900,
  uploadedById: "S1",
  createdAt: "2026-02-03T00:00:00.000Z",
  url: null,
  image: false,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  workRightsRecordId: null,
  ...over,
});

describe("which record is in force", () => {
  it("is the latest CHECK, even when an older record expires later", () => {
    /* The 2024 check said the 482 ran to 2030. This morning's check says the
       person is on a bridging visa expiring next month. The bridging visa is
       what the employer may rely on — and it is the one with the EARLIER
       expiry, which is precisely why expiry cannot be the sort key. */
    const stale = rec({ id: "STALE", checkedOn: "2024-06-01", expiresOn: "2030-01-01" });
    const today = rec({
      id: "TODAY",
      checkedOn: "2026-07-24",
      expiresOn: "2026-08-20",
      status: "Conditional working rights (visa)",
      visaType: "Bridging visa A",
    });
    expect(currentCheck([stale, today])?.id).toBe("TODAY");
    expect(previousChecks([stale, today]).map((r) => r.id)).toEqual(["STALE"]);
  });

  it("breaks a same-day tie on which was entered last", () => {
    const first = rec({ id: "A", checkedOn: "2026-07-24", createdAt: "2026-07-24T01:00:00.000Z" });
    const second = rec({ id: "B", checkedOn: "2026-07-24", createdAt: "2026-07-24T09:00:00.000Z" });
    expect(currentCheck([first, second])?.id).toBe("B");
  });

  it("is nothing when nothing has been checked", () => {
    expect(currentCheck([])).toBeNull();
    expect(previousChecks([])).toEqual([]);
  });
});

describe("the evidence", () => {
  it("takes what was filed against a check AND the document it was read from", () => {
    const c = rec({ documentId: "SCAN" });
    const filed = doc({ id: "FILED", workRightsRecordId: "C1" });
    expect(checkDocuments([filed, doc({ id: "SCAN" }), doc({ id: "OTHER" })], c).map((d) => d.id)).toEqual([
      "FILED",
      "SCAN",
    ]);
  });

  it("never loses evidence that sits under no check", () => {
    const c = rec({ documentId: "SCAN" });
    expect(looseCheckDocuments([doc({ id: "SCAN" }), doc({ id: "LOOSE" })], [c]).map((d) => d.id)).toEqual([
      "LOOSE",
    ]);
  });
});

describe("what the status says", () => {
  it("keeps 'does not expire' apart from 'nobody has said'", () => {
    /* Collapsing these two is the bug work-rights.ts's `isNoVisa` was written
       to kill: a citizen's card read as an unanswered question forever, with
       no action anybody could take to clear it. */
    expect(checkState(null, TODAY, WARN)).toBe("none");
    expect(checkState(rec({ status: "Australian citizen", expiresOn: null }), TODAY, WARN)).toBe("forever");
  });

  it("warns and fails on the same window as everything else", () => {
    expect(checkState(rec({ expiresOn: "2026-08-07" }), TODAY, WARN)).toBe("warn"); // 14 days
    expect(checkState(rec({ expiresOn: "2028-03-04" }), TODAY, WARN)).toBe("ok");
    expect(checkState(rec({ expiresOn: "2026-07-01" }), TODAY, WARN)).toBe("bad");
  });

  it("gives a citizen their status as the headline, not a countdown", () => {
    expect(checkHeadline(rec({ status: "Australian citizen", expiresOn: null }), TODAY, WARN)).toBe(
      "Australian citizen"
    );
    expect(checkHeadline(null, TODAY, WARN)).toBe("Right to work not recorded");
    expect(checkHeadline(rec({ expiresOn: "2026-07-01" }), TODAY, WARN)).toMatch(/^Expired /);
    expect(checkHeadline(rec({ expiresOn: "2028-03-04" }), TODAY, WARN)).toMatch(/^Expires /);
  });

  it("says what was checked and when, under the headline", () => {
    expect(checkSubline(rec())).toBe(
      "482 Temporary Skill Shortage · expires 4 Mar 2028 · checked 3 Feb 2026"
    );
    expect(checkSubline(rec({ status: "Australian citizen", visaType: null, expiresOn: null }))).toBe(
      "no expiry · checked 3 Feb 2026"
    );
    expect(checkSubline(null)).toMatch(/Record a check/);
  });
});

describe("the facts grid", () => {
  it("prints no empty visa rows for someone who has never held a visa", () => {
    const labels = checkFacts(rec({ status: "Australian citizen", visaType: null, expiresOn: null }), "forever").map(
      (f) => f.label
    );
    expect(labels).toEqual(["Status", "Checked"]);
  });

  it("prints the visa block for someone who holds one", () => {
    expect(checkFacts(rec(), "ok").map((f) => f.label)).toEqual([
      "Status",
      "VISA",
      "Work condition",
      "Expiry",
      "Checked",
    ]);
  });

  it("has nowhere to show a personal detail", () => {
    /* The other half of the reader's promise: nothing here can display a name,
       a date of birth, a nationality or a passport number, because there is no
       column for one. */
    const labels = checkFacts(rec(), "ok").map((f) => f.label);
    for (const banned of ["NAME", "DATE OF BIRTH", "DOB", "NATIONALITY", "PASSPORT", "ADDRESS"]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("names a check by status and visa, and says how it got here", () => {
    expect(checkEvent(rec())).toBe("Full working rights (visa) · 482 Temporary Skill Shortage");
    expect(checkEvent(rec({ visaType: null }))).toBe("Full working rights (visa)");
    expect(checkAddedText(rec())).toBe("Added 3 Feb 2026 · VEVO check");
    expect(checkAddedText(rec({ source: null, createdAt: null }))).toBe("");
  });
});

describe("what may be saved as a check", () => {
  const ok = { status: "Full working rights (visa)", checkedOn: "2026-02-03" };

  it("needs a status, and only one the app knows", () => {
    expect("error" in buildWorkRightsCheckRow({ checkedOn: "2026-02-03" })).toBe(true);
    const made = buildWorkRightsCheckRow({ status: "Probably fine", checkedOn: "2026-02-03" });
    expect("error" in made && made.error).toMatch(/isn't one of the work-rights statuses/);
  });

  it("needs the date it was checked — a record nobody can date is not evidence", () => {
    const built = buildWorkRightsCheckRow({ status: ok.status });
    expect("error" in built && built.error).toMatch(/date it was made/i);
  });

  it("DROPS the visa fields for a citizen or permanent resident", () => {
    /* Not merely hidden on the card: a status flicked back and forth in a
       draft must not be able to leave a visa number on the record of somebody
       who has never held one. */
    const built = buildWorkRightsCheckRow({
      status: "Australian citizen",
      checkedOn: "2026-02-03",
      visaType: "482 TSS",
      hoursCondition: "No work limitation",
      expiresOn: "2028-03-04",
    });
    expect("row" in built && built.row.visa_type).toBeNull();
    expect("row" in built && built.row.hours_condition).toBeNull();
    expect("row" in built && built.row.expires_on).toBeNull();
  });

  it("lets a visa holder have no expiry without inventing one", () => {
    const built = buildWorkRightsCheckRow({ ...ok, visaType: "Bridging visa A" });
    expect("row" in built && built.row.expires_on).toBeNull();
    expect("row" in built && built.row.visa_type).toBe("Bridging visa A");
  });

  it("takes dd/mm/yyyy and ISO alike, and normalises to ISO", () => {
    const a = buildWorkRightsCheckRow({ ...ok, checkedOn: "03/02/2026" });
    expect("row" in a && a.row.checked_on).toBe("2026-02-03");
  });

  it("only ever records a source it knows", () => {
    for (const [given, want] of [["vevo", "vevo"], ["scan", "scan"], ["whatever", "manual"]] as const) {
      const built = buildWorkRightsCheckRow({ ...ok, source: given });
      expect("row" in built && built.row.source).toBe(want);
    }
  });
});

describe("the reminder's words", () => {

});

describe("the lock", () => {
  it("gives both section-savers one wording to refuse with", () => {
    expect(WORK_RIGHTS_LOCKED).toMatch(/record a check/i);
  });
});

/* THE WINDOW IS THE ORG'S NUMBER, NOT A CONSTANT. Six hard-coded 30s became one
   argument with no default (lib/expiry.ts), and this is the test that the
   argument is actually read: the same expiry, 20 days out, is quiet at 14
   and warns at 30. A rule that silently kept its own 30 fails here. */
describe("honours the org's window", () => {
  it("is quiet at 14 days and warns at 30 for the same expiry", () => {
    expect(checkState(rec({ expiresOn: "2026-08-13" }), TODAY, 14)).toBe("ok"); // 20 days out
    expect(checkState(rec({ expiresOn: "2026-08-13" }), TODAY, 30)).toBe("warn");
  });
});
