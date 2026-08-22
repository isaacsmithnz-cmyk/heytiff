/* First-run company setup — the standard facts a new business is walked
   through on its first sign-in, before the empty dashboard has a chance to
   read as a broken product.

   Pure module: the step list and the routing of a rejected save back to the
   step that holds the offending field. Server reads live in query.ts
   (orgSetupPending); the writes are app/actions/org-setup.ts, which funnels
   through saveOrgSection so this flow can never write a column the
   Organisation screen couldn't.

   THE STEPS ARE A SUBSET OF THE SETTINGS SECTIONS, on purpose. Each step maps
   to exactly one ORG_EDITABLE_SECTIONS section, and every field it offers is
   in that section's allowlist — a test pins this, because a field named here
   but not there would render, accept typing, and be dropped silently on save.
   The subset is the invoice-and-letterhead basics; ACN, website, the logo and
   the brand colour stay on the Organisation screen, where they were always
   optional. */

export const SETUP_STEPS = [
  {
    section: "identity",
    title: "Your business",
    fields: ["trading_name", "legal_name", "abn", "gst_registered"],
  },
  {
    section: "contact",
    title: "Contact details",
    fields: ["email", "phone", "address", "suburb", "state", "postcode"],
  },
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/** Everything the wizard drafts, as the form strings the actions expect —
    "" for unset, "Yes"/"No" for the GST segmented control. */
export type SetupDraft = {
  trading_name: string;
  legal_name: string;
  abn: string;
  gst_registered: string;
  email: string;
  phone: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
};

export const EMPTY_SETUP_DRAFT: SetupDraft = {
  trading_name: "",
  legal_name: "",
  abn: "",
  gst_registered: "",
  email: "",
  phone: "",
  address: "",
  suburb: "",
  state: "",
  postcode: "",
};

/** The draft split into the per-section payloads completeOrgSetup takes —
    each step's fields only, so the action patches nothing the wizard never
    showed. */
export function draftSections(draft: SetupDraft): {
  identity: Record<string, string>;
  contact: Record<string, string>;
} {
  const pick = (step: SetupStep) =>
    Object.fromEntries(step.fields.map((f) => [f, draft[f as keyof SetupDraft] ?? ""]));
  return { identity: pick(SETUP_STEPS[0]), contact: pick(SETUP_STEPS[1]) };
}

/* A rejected save names columns; the wizard shows one step at a time. This
   answers "which step do those columns live on?" so the error lands in front
   of the field it is about instead of on whichever screen happened to submit.
   Unknown fields (or none) resolve to the first step — the failure has to
   land SOMEWHERE visible, and the front is where the flow restarts. */
export function stepForFields(fields: readonly string[] | undefined): number {
  for (const name of fields ?? []) {
    const i = SETUP_STEPS.findIndex((s) => (s.fields as readonly string[]).includes(name));
    if (i >= 0) return i;
  }
  return 0;
}
