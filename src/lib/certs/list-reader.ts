import { matchRequirement } from "./quote";
import type { ClauseKey } from "./mechanical";

/* A CERTIFIER'S LIST, READ BY TIFF — the prompt, the shape asked for, and
   the reading of what came back. Pure, so it can be tested without a model.

   THE SAME CONTRACT AS A SCANNED LICENCE (lib/org/cred-readers): one model
   call fills the form, the person checks it against the paper, and nothing
   is saved until they do. Tiff only READS the list. Which clause answers each
   requirement is decided here, by the pure matcher (quote.ts), and the person
   can change it: matching is a rule that can be tested, so it isn't left to
   the model. */

const nullable = (t: "string") => ({ type: [t, "null"] });

export const CERT_LIST_SCHEMA = {
  type: "object",
  properties: {
    certifier: nullable("string"),
    projectNumber: nullable("string"),
    consentAuthority: nullable("string"),
    address: nullable("string"),
    requirements: { type: "array", items: { type: "string" } },
  },
  required: ["certifier", "projectNumber", "consentAuthority", "address", "requirements"],
  additionalProperties: false,
} as const;

export const CERT_LIST_PROMPT =
  "This is a building certifier's list of requirements for an Occupation Certificate. Extract:\n" +
  "- certifier: the certifier's company name, as printed\n" +
  "- projectNumber: the certifier's project or job number, as printed\n" +
  "- consentAuthority: the council or consent authority named\n" +
  "- address: the address of the development\n" +
  "- requirements: every requirement under the MECHANICAL item (mechanical services, mechanical ventilation, " +
  "air conditioning), one string each, word for word. A requirement written as bullet points is one string per " +
  "bullet; an introductory line that only says what follows is not a requirement. Leave out every other trade's " +
  "items (electrical, fire safety, glazing, waterproofing, structural, energy efficiency, BASIX).\n" +
  "Use null for anything the document doesn't say, and an empty list when there is no mechanical item. " +
  "Never guess.";

export type ListReading = {
  certifier: string;
  projectNumber: string;
  consentAuthority: string;
  address: string;
  requirements: { text: string; clause: ClauseKey | null; notOurs: boolean }[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What the model handed back, read into the form the wizard shows. */
export function parseListReading(raw: unknown): ListReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reqs = Array.isArray(r.requirements) ? r.requirements : [];
  return {
    certifier: str(r.certifier, 120),
    projectNumber: str(r.projectNumber, 60),
    consentAuthority: str(r.consentAuthority, 120),
    address: str(r.address, 200),
    requirements: reqs
      .map((t) => str(t, 600))
      .filter(Boolean)
      .slice(0, 30)
      .map((text) => ({ text, ...matchRequirement(text) })),
  };
}
