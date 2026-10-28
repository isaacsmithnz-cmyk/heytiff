/**
 * @jest-environment node
 */

/* Documents on the phone (lib/mobile/documents), drawn on Diamond Air's real
   papers on 29 October 2026: public liability with QBE (08U693177BPK,
   $20,000,000, to 10 Nov 2026, its certificate "DIAM MI CofC.pdf"), workers
   compensation with icare (127993501, 11 workers, to 28 Feb 2027), and
   Isaac's three licences. The words and the term rules are the web's own;
   the reads are stand-ins. */

import type { OrgCredential } from "@/lib/org/credentials";
import type { OrgCredentialRecord } from "@/lib/org/credential-records";
import type { StoredDocument } from "@/lib/documents/query";
import type { StaffLicence } from "@/lib/staff/types";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/au-dates", () => ({ ...jest.requireActual("@/lib/au-dates"), todayInAu: () => "2026-10-29" }));

const pl: OrgCredential = { id: "c-pl", kind: "insurance", name: "Public liability", number: "08U693177BPK", issuer: "QBE Insurance (Australia) Ltd", expiryDate: "2026-11-10", color: null };
const wc: OrgCredential = { id: "c-wc", kind: "insurance", name: "Workers compensation", number: "127993501", issuer: "icare Workers Insurance", expiryDate: "2027-02-28", color: "#8A2BE2" };
const arc: OrgCredential = { id: "c-arc", kind: "licence", name: "ARC refrigerant trading authorisation", number: "AU12345", issuer: "Australian Refrigeration Council", expiryDate: "2026-12-01", color: null };
const term = (over: Partial<OrgCredentialRecord>): OrgCredentialRecord => ({
  id: "r",
  credentialId: "c",
  issuer: null,
  number: null,
  cover: null,
  sumInsured: null,
  premium: null,
  excess: null,
  workersCount: null,
  wages: null,
  startsOn: null,
  expiresOn: "2026-11-10",
  documentId: null,
  source: "scan",
  createdAt: null,
  ...over,
});
const plTerm = term({ id: "r-pl", credentialId: "c-pl", issuer: pl.issuer, number: pl.number, cover: "Broadform Liability - Air conditioning installation", sumInsured: 20000000, premium: 4180, excess: 500, startsOn: "2025-11-10", documentId: "d-cofc" });
const wcTerm = term({ id: "r-wc", credentialId: "c-wc", issuer: wc.issuer, number: wc.number, cover: "423300 Air Conditioning and Heating Services", workersCount: 11, wages: 812000, premium: 21000, startsOn: "2026-02-28", expiresOn: "2027-02-28", documentId: "d-wc" });
const doc = (over: Partial<StoredDocument>): StoredDocument => ({
  id: "d",
  kind: "org_insurance",
  fileName: "x.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
  uploadedById: null,
  createdAt: "2026-09-08T00:00:00Z",
  url: "https://signed/x",
  image: false,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  workRightsRecordId: null,
  ...over,
});
const lic = (over: Partial<StaffLicence>): StaffLicence => ({ id: "l", typeName: "", licenceNumber: null, expiryDate: null, color: null, ...over });

let staffId: string | null = "card-isaac";
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => staffId }));
jest.mock("@/lib/org/query", () => ({
  orgExpiryWindow: async () => ({ warnDays: 30, email: true }),
  listOrgCredentials: async () => [arc, pl, wc],
  listOrgCredentialRecords: async () => ({ "c-pl": [plTerm], "c-wc": [wcTerm] }),
}));
jest.mock("@/lib/documents/query", () => ({
  documentsForOrgCredentials: async () =>
    new Map([
      ["c-pl", [doc({ id: "d-cofc", fileName: "DIAM MI CofC.pdf", url: "https://signed/cofc", credentialRecordId: "r-pl" })]],
      ["c-wc", [doc({ id: "d-wc", fileName: "Work Cover 2026 2027.pdf", url: "https://signed/wc", credentialRecordId: "r-wc" })]],
    ]),
}));
const listed: string[] = [];
jest.mock("@/lib/staff/query", () => ({
  listLicences: async (_o: string, s: string) => (
    listed.push(s),
    [
      lic({ id: "l-white", typeName: "White card", licenceNumber: "719065", color: "#8A2BE2" }),
      lic({ id: "l-cl", typeName: "Contractor licence", licenceNumber: "315890C", expiryDate: "2027-10-09", color: "#F0A431" }),
      lic({ id: "l-arc", typeName: "ARC licence", licenceNumber: "L118650", expiryDate: "2027-08-16", color: "#00A389" }),
    ]
  ),
}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({
        data: t === "organizations" ? { name: "Diamond Air Solutions Pty Ltd" } : { first_name: "Isaac", last_name: "Smith", preferred_name: "Ike" },
      });
      return q;
    },
  },
}));

import { phoneLicence, phonePaper, readPhoneDocuments } from "@/lib/mobile/documents";

const ctx = { userId: "auth0|isaac", orgId: "org-diamond", role: "member", caps: new Set(), orgIds: ["org-diamond"] } as never;

beforeEach(() => {
  staffId = "card-isaac";
  listed.length = 0;
});

test("the company's papers: insurance first, each as its term reads, with its certificate", async () => {
  const d = await readPhoneDocuments(ctx);
  expect(d.company.map((p) => p.name)).toEqual(["Public liability", "Workers compensation", "ARC refrigerant trading authorisation"]);
  const [p, w] = d.company;
  expect(p).toEqual({
    id: "c-pl",
    name: "Public liability",
    line: "QBE Insurance (Australia) Ltd, to 10 Nov 2026",
    word: { text: "Renews in 12 days", tone: "look" },
    facts: [
      { label: "Insurer", value: "QBE Insurance (Australia) Ltd" },
      { label: "Policy", value: "08U693177BPK" },
      { label: "Cover", value: "$20,000,000, Broadform Liability - Air conditioning installation" },
      { label: "Runs to", value: "10 Nov 2026" },
    ],
    file: { name: "DIAM MI CofC.pdf", url: "https://signed/cofc", image: false, mime: "application/pdf" },
  });
  /* workers comp: its classification, its head count; never the wages or premium */
  expect(w.word).toBeNull();
  expect(w.facts).toEqual([
    { label: "Insurer", value: "icare Workers Insurance" },
    { label: "Policy", value: "127993501" },
    { label: "Industry classification", value: "423300 Air Conditioning and Heating Services" },
    { label: "Workers", value: "11" },
    { label: "Runs to", value: "28 Feb 2027" },
  ]);
  expect(JSON.stringify(d.company)).not.toMatch(/4,180|4180|21,000|812/);
  /* a card with no term reads off the card itself, and has no certificate */
  expect(d.company[2]).toMatchObject({
    line: "Australian Refrigeration Council, to 1 Dec 2026",
    facts: [
      { label: "Issued by", value: "Australian Refrigeration Council" },
      { label: "Licence", value: "AU12345" },
      { label: "Runs to", value: "1 Dec 2026" },
    ],
    file: null,
  });
});

test("your licences: your own card's, soonest to run out first, under your own name", async () => {
  const d = await readPhoneDocuments(ctx);
  expect(listed).toEqual(["card-isaac"]);
  expect(d.licences.map((l) => [l.name, l.number, l.runsTo])).toEqual([
    ["ARC licence", "L118650", "Runs to 16 Aug 2027"],
    ["Contractor licence", "315890C", "Runs to 9 Oct 2027"],
    ["White card", "719065", null],
  ]);
  expect(d.me).toBe("Isaac Smith");
  expect(d.org).toBe("Diamond Air Solutions Pty Ltd");
});

test("no card in Team: the company's papers, and no licences", async () => {
  staffId = null;
  const d = await readPhoneDocuments(ctx);
  expect(listed).toEqual([]);
  expect(d.licences).toEqual([]);
  expect(d.me).toBeNull();
  expect(d.company).toHaveLength(3);
});

test("close to running out says so in the web's words; gone, in red", () => {
  expect(phoneLicence(lic({ typeName: "ARC licence", expiryDate: "2026-11-10" }), "2026-10-29", 30).word).toEqual({ text: "Expires in 12 days", tone: "look" });
  expect(phoneLicence(lic({ typeName: "ARC licence", expiryDate: "2026-10-01" }), "2026-10-29", 30).word).toEqual({ text: "Expired", tone: "wrong" });
  expect(phonePaper(pl, [plTerm], [], "2026-11-14", 30).word).toEqual({ text: "Expired 4 days ago", tone: "wrong" });
  /* the warning days are the workspace's own */
  expect(phonePaper(pl, [plTerm], [], "2026-10-29", 7).word).toBeNull();
});

test("the certificate is the term in force's, a PDF before a photo; else one filed on the card", () => {
  const photo = doc({ id: "d-photo", fileName: "cofc.jpg", image: true, mimeType: "image/jpeg", url: "https://signed/photo", credentialRecordId: "r-pl" });
  const pdf = doc({ id: "d-pdf", fileName: "cofc.pdf", url: "https://signed/pdf", credentialRecordId: "r-pl" });
  expect(phonePaper(pl, [plTerm], [photo, pdf], "2026-10-29", 30).file?.name).toBe("cofc.pdf");
  const old = doc({ id: "d-old", fileName: "2024.pdf", url: "https://signed/old", credentialRecordId: "r-old" });
  const loose = doc({ id: "d-loose", fileName: "card.pdf", url: "https://signed/loose" });
  const oldTerm = term({ id: "r-old", credentialId: "c-pl", expiresOn: "2025-11-10" });
  expect(phonePaper(pl, [term({ ...plTerm, documentId: null }), oldTerm], [old, loose], "2026-10-29", 30).file?.name).toBe("card.pdf");
  /* a link that couldn't be signed is no certificate */
  expect(phonePaper(pl, [plTerm], [doc({ ...pdf, url: null })], "2026-10-29", 30).file).toBeNull();
});
