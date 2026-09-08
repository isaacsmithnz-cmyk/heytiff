import {
  buildCredentialRecordRow,
  credentialHeadline,
  credentialState,
  credentialStatusText,
  credentialDays,
  currentRecord,
  fmtSumInsured,
  looseDocuments,
  previousRecords,
  recordAddedText,
  recordDocuments,
  recordEvent,
  recordFacts,
  type OrgCredentialRecord,
} from "../credential-records";
import type { StoredDocument } from "@/lib/documents/query";

/* The pure half of the business's licences and insurance.

   The thing this file is really pinning is that A RENEWAL NEVER DESTROYS THE
   TERM BEFORE IT. "Current" is a derivation over rows — the latest expiry —
   so there is no state anywhere that can say a term is current when an older
   row disagrees, and nothing has to be moved or flagged for the history to be
   the history. */

const TODAY = "2026-07-24";

const rec = (over: Partial<OrgCredentialRecord> = {}): OrgCredentialRecord => ({
  id: "R1",
  credentialId: "C1",
  issuer: "QBE",
  number: "PL-9",
  cover: "Public and products liability",
  sumInsured: 20_000_000,
  premium: 2400,
  excess: 500,
  startsOn: "2025-08-07",
  expiresOn: "2026-08-07",
  documentId: null,
  source: "manual",
  createdAt: "2025-08-01T00:00:00.000Z",
  ...over,
});

const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
  id: "D1",
  kind: "org_insurance",
  fileName: "coc.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1000,
  uploadedById: "S1",
  createdAt: "2025-08-01T00:00:00.000Z",
  url: null,
  image: false,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  ...over,
});

describe("which term is in force", () => {
  it("is the latest EXPIRY, not the newest upload", () => {
    /* The row added most recently is last year's certificate, found in a
       drawer and filed after the fact. It must not become the cover the
       business is shown as holding. */
    const filedLater = rec({ id: "OLD", expiresOn: "2025-08-07", createdAt: "2026-07-01T00:00:00.000Z" });
    const inForce = rec({ id: "NEW", expiresOn: "2026-08-07", createdAt: "2025-08-01T00:00:00.000Z" });
    expect(currentRecord([filedLater, inForce])?.id).toBe("NEW");
    expect(previousRecords([filedLater, inForce]).map((r) => r.id)).toEqual(["OLD"]);
  });

  it("is nothing when there are no terms", () => {
    expect(currentRecord([])).toBeNull();
    expect(previousRecords([])).toEqual([]);
  });

  it("lists the history newest first", () => {
    const rows = [
      rec({ id: "A", expiresOn: "2024-08-07" }),
      rec({ id: "C", expiresOn: "2026-08-07" }),
      rec({ id: "B", expiresOn: "2025-08-07" }),
    ];
    expect(previousRecords(rows).map((r) => r.id)).toEqual(["B", "A"]);
  });
});

describe("the paperwork under a term", () => {
  it("takes what was filed against it AND the document it was read from", () => {
    const term = rec({ documentId: "SCAN" });
    const filed = doc({ id: "FILED", credentialRecordId: "R1" });
    const scanned = doc({ id: "SCAN" });
    const other = doc({ id: "OTHER" });
    expect(recordDocuments([filed, scanned, other], term).map((d) => d.id)).toEqual(["FILED", "SCAN"]);
  });

  it("never loses a document that sits under no term", () => {
    /* A file the card owns but no term claims would otherwise be invisible,
       and an invisible document store is the one thing it must never be. */
    const term = rec({ documentId: "SCAN" });
    const orphan = doc({ id: "LOOSE" });
    expect(looseDocuments([doc({ id: "SCAN" }), orphan], [term]).map((d) => d.id)).toEqual(["LOOSE"]);
  });
});

describe("what the status says", () => {
  it("treats nothing-recorded as its own state, never as ok", () => {
    // silence about cover is not evidence of cover
    expect(credentialState(null, TODAY)).toBe("none");
    expect(credentialDays(null, TODAY)).toBeNull();
    expect(credentialStatusText(null)).toBe("No expiry recorded");
  });

  it("warns inside the same window the staff card and the dashboard chip use", () => {
    expect(credentialState("2026-08-07", TODAY)).toBe("warn"); // 14 days out
    expect(credentialState("2026-12-01", TODAY)).toBe("ok");
    expect(credentialState("2026-07-01", TODAY)).toBe("bad");
  });

  it("says the plain thing in the headline", () => {
    expect(credentialHeadline("insurance", "2026-12-01", TODAY)).toBe("Covered");
    expect(credentialHeadline("licence", "2026-12-01", TODAY)).toBe("Current");
    expect(credentialHeadline("insurance", null, TODAY)).toBe("No policy recorded");
    expect(credentialHeadline("insurance", "2026-07-01", TODAY)).toMatch(/^Expired /);
  });
});

describe("the facts grid", () => {
  it("prints an insurance term's own fields, and a licence's own", () => {
    const ins = recordFacts("insurance", rec(), "ok").map((f) => f.label);
    expect(ins).toEqual(["INSURER", "POLICY NO.", "COVER", "LIMIT", "STARTS", "EXPIRY", "PREMIUM", "EXCESS"]);

    const lic = recordFacts("licence", rec(), "ok").map((f) => f.label);
    expect(lic).toEqual(["ISSUED BY", "LICENCE NO.", "CLASSES", "ISSUED", "EXPIRY", "FEE PAID"]);
    // a licence has no limit and no excess — those are insurance facts
    expect(lic).not.toContain("LIMIT");
    expect(lic).not.toContain("EXCESS");
  });

  it("shows an empty field as a quiet dash, never as a zero", () => {
    const facts = recordFacts("insurance", rec({ premium: null, issuer: null }), "ok");
    const premium = facts.find((f) => f.label === "PREMIUM")!;
    expect(premium.value).toBe("—");
    expect(premium.tone).toBe("faint");
    expect(facts.find((f) => f.label === "INSURER")!.value).toBe("—");
  });

  it("marks the expiry as a warning only when it is one", () => {
    expect(recordFacts("insurance", rec(), "ok").find((f) => f.label === "EXPIRY")!.tone).toBeUndefined();
    expect(recordFacts("insurance", rec(), "warn").find((f) => f.label === "EXPIRY")!.tone).toBe("warn");
  });

  it("says a limit of liability the way a broker says it", () => {
    expect(fmtSumInsured(20_000_000)).toBe("$20m");
    expect(fmtSumInsured(1_500_000)).toBe("$1.5m");
    expect(fmtSumInsured(250_000)).toBe("$250,000");
  });

  it("names a term by who it is with", () => {
    expect(recordEvent("insurance", rec())).toBe("Policy · QBE");
    expect(recordEvent("licence", rec({ issuer: null }))).toBe("Licence term");
  });

  it("says how a term got here", () => {
    expect(recordAddedText(rec({ source: "scan" }))).toBe("Added 1 Aug 2025 · scanned from the document");
    expect(recordAddedText(rec({ source: null, createdAt: null }))).toBe("");
  });
});

describe("what may be saved as a term", () => {
  it("refuses a term with no expiry — the expiry is what makes it one", () => {
    const built = buildCredentialRecordRow({ issuer: "QBE" });
    expect("error" in built && built.error).toMatch(/expiry/i);
  });

  it("refuses a date it cannot read, rather than guessing at dd/mm", () => {
    expect("error" in buildCredentialRecordRow({ expiresOn: "not a date" })).toBe(true);
  });

  it("refuses a term that ends before it begins", () => {
    /* Saved, it would sort as the current record and silence the real one
       behind it — a typo that turns into a false all-clear. */
    const built = buildCredentialRecordRow({ startsOn: "07/08/2027", expiresOn: "07/08/2026" });
    expect("error" in built && built.error).toMatch(/after the expiry/i);
  });

  it("takes dd/mm/yyyy and ISO alike, and normalises to ISO", () => {
    const a = buildCredentialRecordRow({ expiresOn: "07/08/2026" });
    const b = buildCredentialRecordRow({ expiresOn: "2026-08-07" });
    expect("row" in a && a.row.expires_on).toBe("2026-08-07");
    expect("row" in b && b.row.expires_on).toBe("2026-08-07");
  });

  it("never invents a figure out of an empty box", () => {
    const built = buildCredentialRecordRow({ expiresOn: "2026-08-07", premium: "", excess: "  " });
    expect("row" in built && built.row.premium).toBeNull();
    expect("row" in built && built.row.excess).toBeNull();
  });

  it("takes a typed dollar figure with its punctuation", () => {
    const built = buildCredentialRecordRow({ expiresOn: "2026-08-07", premium: "$2,400.50", sumInsured: "20000000" });
    expect("row" in built && built.row.premium).toBe(2400.5);
    expect("row" in built && built.row.sum_insured).toBe(20_000_000);
  });

  it("refuses a negative as a blank rather than storing it", () => {
    const built = buildCredentialRecordRow({ expiresOn: "2026-08-07", premium: -50 });
    expect("row" in built && built.row.premium).toBeNull();
  });

  it("only ever records a source it knows", () => {
    const scan = buildCredentialRecordRow({ expiresOn: "2026-08-07", source: "scan" });
    const junk = buildCredentialRecordRow({ expiresOn: "2026-08-07", source: "whatever" });
    expect("row" in scan && scan.row.source).toBe("scan");
    expect("row" in junk && junk.row.source).toBe("manual");
  });

  it("keeps blanks as nulls, not as empty strings", () => {
    const built = buildCredentialRecordRow({ expiresOn: "2026-08-07", issuer: "  ", cover: "" });
    expect("row" in built && built.row.issuer).toBeNull();
    expect("row" in built && built.row.cover).toBeNull();
  });
});
