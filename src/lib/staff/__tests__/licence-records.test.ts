import type { StoredDocument } from "@/lib/documents/query";
import {
  buildLicenceTermRow,
  currentTerm,
  licenceDays,
  looseTermDocuments,
  previousTerms,
  termAddedText,
  termDocuments,
  termEvent,
  termFacts,
  termHeadline,
  termState,
  termStatusText,
  type StaffLicenceRecord,
  splitAddScan,
} from "../licence-records";

/* The pure half of a staff ticket's terms.

   What this file is really pinning is that RECORDING A RENEWAL NEVER DESTROYS
   THE TERM BEFORE IT. "Current" is a derivation over rows — the latest expiry
   — so no stored state can claim one term is current while an older row
   disagrees, and nothing has to be moved or flagged for the history to be the
   history. Before this, the only way to renew a ticket was to delete it and
   add it again. */

const WARN = 30; // the org window every fixture here assumes
const TODAY = "2026-07-24";

const rec = (over: Partial<StaffLicenceRecord> = {}): StaffLicenceRecord => ({
  id: "T1",
  licenceId: "L1",
  issuer: "Australian Refrigeration Council",
  number: "AU123",
  classes: "Split systems",
  issuingState: "NSW",
  startsOn: "2024-08-07",
  expiresOn: "2026-08-07",
  documentId: null,
  source: "scan",
  createdAt: "2024-08-01T00:00:00.000Z",
  ...over,
});

const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
  id: "D1",
  kind: "licence",
  fileName: "arc.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  uploadedById: "S1",
  createdAt: "2024-08-01T00:00:00.000Z",
  url: null,
  image: true,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  workRightsRecordId: null,
  ...over,
});

describe("which term is in force", () => {
  it("is the latest EXPIRY, not the newest upload", () => {
    /* The row added most recently is an old card photographed after the fact.
       It must not become the ticket the person is shown as holding. */
    const filedLater = rec({ id: "OLD", expiresOn: "2024-08-07", createdAt: "2026-07-01T00:00:00.000Z" });
    const inForce = rec({ id: "NEW", expiresOn: "2026-08-07", createdAt: "2024-08-01T00:00:00.000Z" });
    expect(currentTerm([filedLater, inForce])?.id).toBe("NEW");
    expect(previousTerms([filedLater, inForce]).map((r) => r.id)).toEqual(["OLD"]);
  });

  it("is nothing when there are no terms", () => {
    expect(currentTerm([])).toBeNull();
    expect(previousTerms([])).toEqual([]);
  });

  it("lists the history newest first", () => {
    const rows = [
      rec({ id: "A", expiresOn: "2020-08-07" }),
      rec({ id: "C", expiresOn: "2026-08-07" }),
      rec({ id: "B", expiresOn: "2023-08-07" }),
    ];
    expect(previousTerms(rows).map((r) => r.id)).toEqual(["B", "A"]);
  });
});

describe("the paperwork under a term", () => {
  it("takes what was filed against it AND the photo it was read from", () => {
    const t = rec({ documentId: "SCAN" });
    const filed = doc({ id: "FILED", licenceRecordId: "T1" });
    expect(termDocuments([filed, doc({ id: "SCAN" }), doc({ id: "OTHER" })], t).map((d) => d.id)).toEqual([
      "FILED",
      "SCAN",
    ]);
  });

  it("never loses a document that sits under no term", () => {
    const t = rec({ documentId: "SCAN" });
    expect(looseTermDocuments([doc({ id: "SCAN" }), doc({ id: "LOOSE" })], [t]).map((d) => d.id)).toEqual([
      "LOOSE",
    ]);
  });
});

describe("what the status says", () => {
  it("treats nothing-recorded as its own state, never as ok", () => {
    // silence about a ticket is not evidence the person holds one
    expect(termState(null, TODAY, WARN)).toBe("none");
    expect(licenceDays(null, TODAY)).toBeNull();
    expect(termStatusText(null)).toBe("No expiry recorded");
  });

  it("warns inside the same window the card's pill and the dashboard chip use", () => {
    expect(termState("2026-08-07", TODAY, WARN)).toBe("warn"); // 14 days out
    expect(termState("2027-08-07", TODAY, WARN)).toBe("ok");
    expect(termState("2026-07-01", TODAY, WARN)).toBe("bad");
  });

  it("says the plain thing in the headline", () => {
    expect(termHeadline("2027-08-07", TODAY, WARN)).toBe("Current");
    expect(termHeadline(null, TODAY, WARN)).toBe("No expiry recorded");
    expect(termHeadline("2026-07-01", TODAY, WARN)).toMatch(/^Expired /);
  });
});

describe("the facts grid", () => {
  it("prints what the plastic card prints, and nothing personal", () => {
    const labels = termFacts(rec(), "ok").map((f) => f.label);
    expect(labels).toEqual(["Licence no.", "Issued by", "State", "Classes", "Issued", "Expiry"]);
    /* The reader is deliberately narrow about a government ID
       (lib/staff/licence-readers.ts) and this grid is the other half of that
       promise: there is nowhere here for a name, a date of birth or an
       address to be displayed, because there is nowhere for one to be stored. */
    for (const banned of ["NAME", "DATE OF BIRTH", "DOB", "ADDRESS"]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("shows an empty field as a quiet dash, never as an invented value", () => {
    const facts = termFacts(rec({ classes: null, issuingState: null }), "ok");
    const classes = facts.find((f) => f.label === "Classes")!;
    expect(classes.value).toBe("—");
    expect(classes.tone).toBe("faint");
  });

  it("marks the expiry as a warning only when it is one", () => {
    expect(termFacts(rec(), "ok").find((f) => f.label === "Expiry")!.tone).toBeUndefined();
    expect(termFacts(rec(), "bad").find((f) => f.label === "Expiry")!.tone).toBe("warn");
  });

  it("names a term by who issued it, with the state after", () => {
    /* The issuer LEADS: it is a long name and a "Term ·" prefix pushed the one
       distinguishing word off the end of a history row. */
    expect(termEvent(rec({ issuer: "Service NSW", issuingState: "NSW" }))).toBe("Service NSW (NSW)");
    expect(termEvent(rec({ issuer: "Service NSW", issuingState: null }))).toBe("Service NSW");
    expect(termEvent(rec({ issuer: null, issuingState: "VIC" }))).toBe("VIC licence");
    expect(termEvent(rec({ issuer: null, issuingState: null }))).toBe("Term");
  });

  it("says how a term got here", () => {
    expect(termAddedText(rec())).toBe("Added 1 Aug 2024 · scanned from the card");
    expect(termAddedText(rec({ source: null, createdAt: null }))).toBe("");
  });
});

describe("what may be saved as a term", () => {
  it("refuses a term with no expiry — the expiry is what makes it one", () => {
    const built = buildLicenceTermRow({ number: "AU1" });
    expect("error" in built && built.error).toMatch(/expiry/i);
  });

  it("refuses a date it cannot read, rather than guessing at dd/mm", () => {
    expect("error" in buildLicenceTermRow({ expiresOn: "not a date" })).toBe(true);
  });

  it("refuses a term that ends before it begins", () => {
    /* Saved, it would sort as the current term and silence the real one behind
       it — a typo that becomes a false all-clear on somebody's compliance. */
    const built = buildLicenceTermRow({ startsOn: "07/08/2027", expiresOn: "07/08/2026" });
    expect("error" in built && built.error).toMatch(/after the expiry/i);
  });

  it("takes dd/mm/yyyy and ISO alike, and normalises to ISO", () => {
    const a = buildLicenceTermRow({ expiresOn: "07/08/2026" });
    const b = buildLicenceTermRow({ expiresOn: "2026-08-07" });
    expect("row" in a && a.row.expires_on).toBe("2026-08-07");
    expect("row" in b && b.row.expires_on).toBe("2026-08-07");
  });

  it("keeps blanks as nulls, not as empty strings", () => {
    const built = buildLicenceTermRow({ expiresOn: "2026-08-07", issuer: "  ", classes: "" });
    expect("row" in built && built.row.issuer).toBeNull();
    expect("row" in built && built.row.classes).toBeNull();
  });

  it("only ever records a source it knows", () => {
    const scan = buildLicenceTermRow({ expiresOn: "2026-08-07", source: "scan" });
    const junk = buildLicenceTermRow({ expiresOn: "2026-08-07", source: "whatever" });
    expect("row" in scan && scan.row.source).toBe("scan");
    expect("row" in junk && junk.row.source).toBe("manual");
  });
});

describe("the reminder's words", () => {

});

/* THE WINDOW IS THE ORG'S NUMBER, NOT A CONSTANT. Six hard-coded 30s became one
   argument with no default (lib/expiry.ts), and this is the test that the
   argument is actually read: the same expiry, 20 days out, is quiet at 14
   and warns at 30. A rule that silently kept its own 30 fails here. */
describe("honours the org's window", () => {
  it("is quiet at 14 days and warns at 30 for the same expiry", () => {
    expect(termState("2026-08-13", TODAY, 14)).toBe("ok"); // 20 days out
    expect(termState("2026-08-13", TODAY, 30)).toBe("warn");
    expect(termHeadline("2026-08-13", TODAY, 14)).toBe("Current");
  });
});

/* ADDING A TICKET FROM A SCAN. A term needs an expiry, so a white card — which
   never lapses — cannot be one, and it must still keep the number read off it
   and the photo itself. The add screen used to drop both. */
describe("adding a ticket from a scan", () => {
  const ticket = { typeName: "White card" };

  it("adds a plain ticket when nothing was scanned", () => {
    expect(splitAddScan(ticket)).toEqual({ input: ticket, term: null, cardDocumentId: null });
  });

  it("makes a scan with an expiry the first term, its photo riding on the term", () => {
    const scan = { number: "AU123", expiresOn: "2027-05-01", documentId: "doc-7", source: "scan" };
    expect(splitAddScan(ticket, scan)).toEqual({ input: ticket, term: scan, cardDocumentId: null });
  });

  it("puts a scan with no expiry on the ticket, and files its photo against the ticket", () => {
    const scan = {
      number: " WC-12345 ",
      issuer: "SafeWork NSW",
      issuingState: "NSW",
      startsOn: "2019-03-02",
      expiresOn: "",
      documentId: "doc-7",
      source: "scan",
    };
    expect(splitAddScan(ticket, scan)).toEqual({
      input: { ...ticket, licenceNumber: "WC-12345" },
      term: null,
      cardDocumentId: "doc-7",
    });
  });

  it("treats a blank expiry as no expiry", () => {
    expect(splitAddScan(ticket, { expiresOn: "   ", documentId: "doc-7" })).toMatchObject({
      term: null,
      cardDocumentId: "doc-7",
    });
  });

  it("keeps a number typed on the ticket where the scan read none", () => {
    const typed = { ...ticket, licenceNumber: "TYPED-1" };
    expect(splitAddScan(typed, { number: "", expiresOn: "" })).toEqual({
      input: typed,
      term: null,
      cardDocumentId: null,
    });
  });
});
