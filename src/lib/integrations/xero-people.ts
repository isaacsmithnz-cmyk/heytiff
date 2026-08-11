/* Xero's payroll employees, mapped to the shared import shape — sm8-people's
   sibling, and deliberately as small.

   WHAT IS NOT MAPPED, and why. `employmentType` (EMPLOYEE / CONTRACTOR) is
   right there on the employee, and it stays there: HeyTiff owns
   `employment_type`, and Xero's answer belongs in the drift lane where it
   arrives as a suggestion with its reason attached (linking.ts). Copying it
   in at import would make the import screen a second, quieter writer of a
   pay-adjacent field — the exact "two systems fighting" the whole track
   exists to prevent. Same for anything wage-shaped: it is never on this path.

   No phone: Xero's payroll employee list carries no number, and inventing a
   null field would imply we looked. */

import type { ImportCandidate } from "./people-import";
import type { XeroEmployee } from "./xero-shape";

/** One shaped Xero employee → the shared shape. Total: `shapeEmployee` has
    already dropped anything without an id or a name, so there is nothing left
    here that could fail. */
export function xeroPersonOf(e: XeroEmployee): ImportCandidate {
  return {
    id: e.employeeId,
    first: e.firstName || null,
    last: e.lastName || null,
    name: e.name,
    jobTitle: e.jobTitle,
    email: e.email,
    phone: null,
    // false once Xero says TERMINATED — imported as an Inactive card, so a
    // leaver can still be linked to history without joining the roster.
    active: e.active,
  };
}
