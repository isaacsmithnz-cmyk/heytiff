/* Role type + hierarchy check, re-exported for server code.

   There is deliberately NO session-reading role helper here any more.
   The old getOrgRole() read the session-cached orgRole, which goes stale
   until re-login — it let a demoted admin keep invite rights and was the
   root cause of two fixed holes. For enforcement use:
     - can(capability)  from "@/lib/permissions-server"  (feature gates)
     - getDbRole()      from "@/lib/permissions-server"  (owner-intrinsics)
   Both read memberships fresh per request. */

export type { Role } from "./roles-shared";
export { hasMinRole } from "./roles-shared";
