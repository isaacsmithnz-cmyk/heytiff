/* THE TEMPLATES — every document and message the business sends that is
   written from fixed wording, grouped by who receives it.

   Its own module, with no "use client", so the list page and each template's
   page read the same entries on the server, and the old `?sec=` addresses
   can be sent on by key.

   What is NOT here, on purpose: the quote kits (prices and parts, in Admin →
   Quoting), Tiff's instructions, the Toolbox, and HeyTiff's own sign-in and
   invitation emails, which are the same for every business. */
export const TEMPLATES = [
  {
    key: "quote",
    who: "Goes to the customer. Tiff writes the scope; the notes and payment terms are the same on every quote.",
    group: "Customers",
    title: "Quote",
    sub: "The notes, payment terms and site checklist every quote is written from",
    icon: "tag",
  },
  {
    key: "handover",
    who: "Printed from the project, and signed by the customer at handover.",
    group: "Customers",
    title: "Handover sheet",
    sub: "What the customer signs when the job is handed over",
    icon: "check",
  },
  {
    key: "documents-email",
    who: "Goes to the customer or builder with the files picked on the job card.",
    group: "Customers",
    title: "Documents email",
    sub: "The email your licences, insurance and certificates go out with",
    icon: "mail",
  },
  {
    key: "letterhead",
    who: "Every letter the business writes goes out on it: an employment confirmation for a visa, a letter for a loan.",
    group: "Letters",
    title: "Letterhead",
    sub: "Your logo and details at the top of every letter, and how it's signed off",
    icon: "file",
  },
  {
    key: "certificate",
    who: "Goes to the builder or certifier, as a PDF filed on the job.",
    group: "Builders and certifiers",
    title: "Mechanical Compliance Certificate",
    sub: "What you certify, statement by statement",
    icon: "shield",
  },
  {
    key: "swms",
    who: "Printed for the site, and signed on to by the crew.",
    group: "Builders and certifiers",
    title: "SWMS",
    sub: "The safe work method statement the crew signs on to",
    icon: "alert",
  },
  {
    key: "project-checklist",
    who: "Every new project starts with these. Each project's own list can still be changed.",
    group: "Your team",
    title: "Project checklist",
    sub: "What every new project is ticked off against",
    icon: "listCheck",
  },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];
export type TemplateEntry = (typeof TEMPLATES)[number];

export const TEMPLATE_GROUPS = ["Customers", "Builders and certifiers", "Letters", "Your team"] as const;

/** A template by its key, or null when the key names none. */
export function templateFor(key: unknown): TemplateEntry | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}

export const templateHref = (key: TemplateKey) => `/dashboard/admin/templates/${key}`;
