/* What "right to work" can be, and which of those answers make a visa — and a
   visa check — meaningless.

   Pure module, no imports, for the reason `profile.ts` is one: `derive.ts` runs
   on the server and needs `isNoVisa`, and these constants used to live in
   `workrights-card.tsx`, which is `"use client"`. Reaching into a client module
   from server code to borrow a string array pulls the whole card into the
   server graph. The card re-exports them, so nothing that already imported
   them had to move. */

export const WORK_RIGHTS = [
  "Australian citizen",
  "Permanent resident",
  "Full working rights (visa)",
  "Conditional working rights (visa)",
  "No working rights",
] as const;

/** The two statuses that make every visa field meaningless. */
export const NO_VISA_STATUSES: readonly string[] = ["Australian citizen", "Permanent resident"];

/* THE ONE THING THAT READS THIS OUTSIDE THE FORM IS THE COMPLIANCE CHIP.

   A citizen has no visa, so there is no entitlement record to check against —
   the check the chip was asking for is one that cannot be performed and would
   never come back. Left out, the chip read "Work rights unverified" on every
   citizen in the workspace, permanently, with no action anybody could take to
   clear it. That is the same shape as the bug where the chip read
   `work_rights_verified_at` while every form wrote `vevo_checked_at`: a warning
   with no door out. Different cause, same result, so it is worth naming twice. */
export const isNoVisa = (status: string) => NO_VISA_STATUSES.includes(status);
