/* Which paper a job gets from a credential or a ticket. What this pins: a new
   link takes the current term; a link holds the term it was given after a
   renewal comes in, and says it has been renewed only when the renewal has
   paper to give; a pin whose term is gone falls back to the current one; and
   a card that has never had a term gives what is filed on the card. */

import type { StoredDocument } from "@/lib/documents/query";
import type { OrgCredentialRecord } from "@/lib/org/credential-records";
import type { StaffLicenceRecord } from "@/lib/staff/licence-records";
import { credentialPaper, licencePaper } from "../terms";

const doc = (id: string, over: Partial<StoredDocument> = {}): StoredDocument => ({
  id,
  kind: "org_insurance",
  fileName: `${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 1000,
  uploadedById: null,
  createdAt: "2026-01-01T00:00:00Z",
  url: `https://x/${id}`,
  image: false,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  workRightsRecordId: null,
  ...over,
});

const record = (id: string, expiresOn: string, over: Partial<OrgCredentialRecord> = {}): OrgCredentialRecord => ({
  id,
  credentialId: "cred",
  issuer: "icare",
  number: null,
  cover: null,
  sumInsured: null,
  premium: null,
  excess: null,
  workersCount: null,
  wages: null,
  startsOn: null,
  expiresOn,
  documentId: null,
  source: "scan",
  createdAt: null,
  ...over,
});

const term = (id: string, expiresOn: string): StaffLicenceRecord => ({
  id,
  licenceId: "lic",
  issuer: "ARC",
  number: null,
  classes: null,
  issuingState: null,
  startsOn: null,
  expiresOn,
  documentId: null,
  source: "scan",
  createdAt: null,
});

const old = record("r2026", "2026-02-28");
const renewal = record("r2027", "2027-02-28");
const oldCert = doc("coc-2026", { credentialRecordId: "r2026" });
const newCert = doc("coc-2027", { credentialRecordId: "r2027" });

describe("the business's credential", () => {
  it("gives a new link the current term — the latest expiry, not the newest upload", () => {
    const p = credentialPaper([renewal, old], [oldCert, newCert]);
    expect(p.term?.id).toBe("r2027");
    expect(p.files.map((d) => d.id)).toEqual(["coc-2027"]);
    expect(p.renewed).toBe(false);
  });

  it("holds the term that was given after the renewal comes in, and says so", () => {
    const p = credentialPaper([renewal, old], [oldCert, newCert], "r2026");
    expect(p.term?.id).toBe("r2026");
    expect(p.files.map((d) => d.id)).toEqual(["coc-2026"]);
    expect(p.renewed).toBe(true);
  });

  it("isn't renewed by a renewal recorded without its certificate", () => {
    expect(credentialPaper([renewal, old], [oldCert], "r2026").renewed).toBe(false);
  });

  it("reads the scan a term was read from as that term's paper", () => {
    const scanned = record("r2027", "2027-02-28", { documentId: "scan-1" });
    const p = credentialPaper([scanned], [doc("scan-1")]);
    expect(p.files.map((d) => d.id)).toEqual(["scan-1"]);
  });

  it("falls back to the current term when the pinned one has been deleted", () => {
    const p = credentialPaper([renewal], [newCert], "gone");
    expect(p.term?.id).toBe("r2027");
    expect(p.renewed).toBe(false);
  });

  it("gives a card that has never had a term what is filed on the card itself", () => {
    const p = credentialPaper([], [doc("loose")]);
    expect(p.term).toBeNull();
    expect(p.files.map((d) => d.id)).toEqual(["loose"]);
  });

  it("never falls back to loose papers on a card that has terms — they are older than every term", () => {
    const p = credentialPaper([renewal], [doc("loose")]);
    expect(p.term?.id).toBe("r2027");
    expect(p.files).toEqual([]);
  });
});

describe("a person's ticket", () => {
  it("follows the same rule, one level down", () => {
    const front = doc("front", { kind: "licence", licenceRecordId: "t2" });
    const back = doc("back", { kind: "licence", licenceRecordId: "t2" });
    const first = doc("first", { kind: "licence", licenceRecordId: "t1" });
    const terms = [term("t1", "2025-03-01"), term("t2", "2028-03-01")];

    const now = licencePaper(terms, [front, back, first]);
    expect(now.term?.id).toBe("t2");
    expect(now.files.map((d) => d.id)).toEqual(["front", "back"]);

    const pinned = licencePaper(terms, [front, back, first], "t1");
    expect(pinned.files.map((d) => d.id)).toEqual(["first"]);
    expect(pinned.renewed).toBe(true);
  });
});
