import type { Role } from "@/lib/roles-shared";

/* HANDING THE ACCOUNT OVER — the shape and the wording, with no I/O.

   The permissions model has always named this act: `transfer_ownership` is the
   first entry in MASTER_ONLY, and `canRemoveMember` refuses to remove a master
   with the comment "transfer primacy first — DB agrees". What was missing was
   any way to DO it: `primary_owner_user_id` is written once by
   create_org_for_owner at first login and was never updated anywhere in the
   app, so the Account card stated a fact nobody could change.

   WHAT A TRANSFER IS. The named person becomes the master owner (promoted to
   role='owner' if they weren't one), and the outgoing master stays an OWNER —
   a co-owner. Handing over the account is not resigning from the business, and
   an owner who wanted to leave entirely can be removed afterwards, which is
   exactly what they could not be while they held it.

   Pure module: the modal imports it, the action imports it, and the RPC in
   docs/migrations/transfer_org_ownership.sql enforces the same three refusals
   inside the transaction. */

/** Someone the account could be handed to — a member with a login. */
export type OwnerCandidate = {
  userId: string;
  /** their profile name, or null when they have never signed in under one */
  name: string | null;
  email: string | null;
  /** their membership role today — an owner is already a co-owner */
  role: Role;
};

/** "Isaac Smith", or "isaac" from isaac@… for a login with no name yet. */
export function candidateLabel(c: OwnerCandidate): string {
  if (c.name?.trim()) return c.name.trim();
  const local = c.email?.split("@")[0];
  return local?.trim() || c.userId;
}

/* The role, said the way the Team card says it. A co-owner is the safest
   handover there is — they already hold every capability, so nothing about
   what they can see changes; only who cannot be demoted does. */
export function candidateRoleLabel(c: OwnerCandidate): string {
  return c.role === "owner" ? "Co-owner" : c.role === "admin" ? "Admin" : "Staff";
}

/** Sorted for a picker: co-owners first, then admins, then staff, each A–Z. */
export function sortCandidates(list: OwnerCandidate[]): OwnerCandidate[] {
  const rank: Record<Role, number> = { owner: 0, admin: 1, staff: 2 };
  return [...list].sort(
    (a, b) =>
      (rank[a.role] ?? 3) - (rank[b.role] ?? 3) ||
      candidateLabel(a).localeCompare(candidateLabel(b))
  );
}

/* WHY A NON-OWNER IS ALLOWED AT ALL. It would be tidier to insist the new
   master already be a co-owner, and wrong: the common case is a business whose
   second person was never promoted, and refusing them would mean two trips
   through two screens to do one thing. The promotion rides along, and the
   modal says so before the button is pressed rather than after. */
export function transferWarning(c: OwnerCandidate): string | null {
  return c.role === "owner"
    ? null
    : `${candidateLabel(c)} becomes an owner as part of this — full access to the whole account, including money.`;
}
