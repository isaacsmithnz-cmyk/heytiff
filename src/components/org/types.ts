import type { OrgCredentialInput } from "@/lib/org/credentials";
import type { CredentialRecordInput } from "@/lib/org/credential-records";

/* Prop shapes for the Organisation screen, in their own module so the server
   page can import them without pulling a "use client" component into its graph
   — the same arrangement components/profile/types.ts makes for the staff card. */

export type CredResult = { ok: true } | { ok: false; error: string };

export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

export type TransferResult = { ok: true } | { ok: false; error: string };

/** The two ways out of first-run setup (components/org/company-setup.tsx),
    bound by /welcome the way OrgActions is by the Organisation page. */
export type CompanySetupActions = {
  onComplete: (
    identity: Record<string, string>,
    contact: Record<string, string>
  ) => Promise<SaveResult>;
  onSkip: () => Promise<SaveResult>;
};

/** Every write the screen can make, already bound by the page. */
export type OrgActions = {
  onSave: (section: string, fields: Record<string, string>) => Promise<SaveResult>;
  /* A card can be born with its first TERM — the certificate that was scanned
     on the way in — so the add takes both. Everything after that is a renewal,
     which is a term of its own and never an edit of the last one. */
  onAddCredential: (input: OrgCredentialInput, term?: CredentialRecordInput) => Promise<CredResult>;
  onUpdateCredential: (id: string, input: OrgCredentialInput) => Promise<CredResult>;
  onRemoveCredential: (id: string) => Promise<CredResult>;
  /** Files the next term. The card's expiry follows it; nothing is overwritten. */
  onRecordTerm: (credentialId: string, input: CredentialRecordInput) => Promise<CredResult>;
  /** Files another document under a term after the fact. */
  onAttachCredentialDoc: (recordId: string, documentId: string) => Promise<CredResult>;
  /** Removes one term — a scan filed against the wrong card. */
  onRemoveTerm: (recordId: string) => Promise<CredResult>;
  /** The viewer's own reminder for this card, `lead` days before the expiry. */
  onCredentialReminder: (credentialId: string, leadDays: number, on: boolean) => Promise<CredResult>;
  /** points the org at an already-uploaded org_logo document */
  onSetLogo: (documentId: string) => Promise<SaveResult>;
  onClearLogo: () => Promise<SaveResult>;
  /** the one seed colour; the document roles are derived from it at render */
  onSetBrandColor: (hex: string) => Promise<SaveResult>;
  onClearBrandColor: () => Promise<SaveResult>;
  /* Master-only, and absent for everyone else — a co-owner's screen does not
     render the control at all, so the prop is optional rather than a function
     that always refuses. The server refuses too; this is what stops the button
     existing for someone who would only be told no. */
  onTransferOwnership?: (newOwnerUserId: string) => Promise<TransferResult>;
};
