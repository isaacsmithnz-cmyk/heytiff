import type { OrgCredentialInput } from "@/lib/org/credentials";

/* Prop shapes for the Organisation screen, in their own module so the server
   page can import them without pulling a "use client" component into its graph
   — the same arrangement components/profile/types.ts makes for the staff card. */

export type CredResult = { ok: true } | { ok: false; error: string };

export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

export type TransferResult = { ok: true } | { ok: false; error: string };

/** Every write the screen can make, already bound by the page. */
export type OrgActions = {
  onSave: (section: string, fields: Record<string, string>) => Promise<SaveResult>;
  onAddCredential: (input: OrgCredentialInput) => Promise<CredResult>;
  onUpdateCredential: (id: string, input: OrgCredentialInput) => Promise<CredResult>;
  onRemoveCredential: (id: string) => Promise<CredResult>;
  /** points the org at an already-uploaded org_logo document */
  onSetLogo: (documentId: string) => Promise<SaveResult>;
  onClearLogo: () => Promise<SaveResult>;
  /* Master-only, and absent for everyone else — a co-owner's screen does not
     render the control at all, so the prop is optional rather than a function
     that always refuses. The server refuses too; this is what stops the button
     existing for someone who would only be told no. */
  onTransferOwnership?: (newOwnerUserId: string) => Promise<TransferResult>;
};
