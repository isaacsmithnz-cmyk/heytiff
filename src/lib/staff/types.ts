/* The row shape the Team directory renders.

   Everything here except the stored fields is DERIVED at query time (see
   derive.ts) rather than stored: initials, years of service, licence count
   and the compliance chip are all functions of data we already hold, so
   storing them would just create a second thing to keep in sync. */

import type { Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

export type ComplianceState = "ok" | "warn" | "bad";

export type StaffRow = {
  /** staff_profiles.id — the UUID the [staff] route resolves */
  id: string;
  /** Auth0 sub, or null for someone on the roster who hasn't signed up */
  userId: string | null;
  initials: string;
  name: string;
  nickname?: string;
  email: string;
  /** job_title, or an em dash */
  role: string;
  employmentType: string;
  started: string;
  years: string;
  licenceCount: number;
  status: "Active" | "Inactive";
  /** from the Fleet register; "—" until Fleet moves to real tables (Stage 4) */
  compliance: { label: string; state: ComplianceState; expiresDays: number };
  /** org role — drives the Permissions card's selector */
  orgRole: Role | null;
  /** true for the org's single master owner; their card is not editable */
  isMaster: boolean;
  /** which connected system an unclaimed card came from ("ServiceM8");
      null once claimed matters less, so the chip only renders pre-claim */
  importedFrom: string | null;
};

/** One licence row, as the compliance derivation needs it. */
export type StaffLicence = {
  id: string;
  typeName: string;
  licenceNumber: string | null;
  expiryDate: string | null;
  color: string | null;
};

/** What an admin may see/do on a given card — resolved once, passed down. */
export type CardViewerCaps = {
  caps: ReadonlySet<Capability>;
  role: Role | null;
  userId: string;
};

/** An outstanding invitation, shaped for the directory's Pending tab.

    `token` is the invite link itself — possessing it is what lets someone
    join the org, so the query selects it (and `id`) only when the caller asks
    `withLinks`, which the Team page does only for a viewer who may invite.
    For everyone else both are null and never left the database. */
export type PendingInviteRow = {
  /** invitations.id — what renew/revoke act on; null without `withLinks` */
  id: string | null;
  name: string;
  email: string;
  role: string;
  state: "live" | "expired";
  note: string;
  token: string | null;
  /** raw ISO timestamp behind `note`, for anything that needs the date itself */
  expiresAt: string;
};
