/* WHOSE ACCOUNT THIS IS — the four facts the Organisation screen could not
   answer about itself.

   Everything else on that screen is the company as it appears to a CUSTOMER:
   the name on the invoice, the ABN, the address, the licences. None of it says
   who holds the account, how many people are in it, or how long it has been
   running — which is what an owner opening "Organisation" is often actually
   checking.

   Pure module: shape and labels only, so the card can import it. The read
   itself is in query.ts alongside the credentials.

   WHAT THIS SCREEN MAY CHANGE, AND WHAT IT MAY NOT. Ownership now moves from
   here — it is the one master-only act the app has, it is about WHOSE account
   this is, and there is nowhere else it could sensibly live (an earlier version
   of this comment sent it to "/handover", which is the project handover SHEET
   and has nothing to do with ownership; the flow simply did not exist).

   The other three still belong elsewhere and stay read-only: the owner's NAME
   and EMAIL come from `profiles`, which is overwritten from the identity
   provider on every sign-in, so an edit here would be erased at next login; the
   plan is billing; the member count is Team's. Those link out. */

/** The account's own facts, already resolved to what the card prints. */
export type OrgAccount = {
  /** the primary owner's display name, falling back to their email's local
      part, and null only when the profile row is missing entirely */
  ownerName: string | null;
  ownerEmail: string | null;
  /** true when the person reading the screen IS the primary owner — a
      co-owner sees the same card and needs to know it isn't them. It is also
      exactly the condition for the handover control, because the master is the
      only person who may transfer (MASTER_ONLY in lib/permissions.ts). */
  ownerIsYou: boolean;
  /** staff_profiles rows with status Active — the same population the Team
      page counts, so the two screens can never disagree */
  activeStaff: number;
  /** total staff rows, active or not */
  totalStaff: number;
  /** organizations.created_at, ISO */
  createdAt: string | null;
  /** organizations.plan — a free-text column with a known set of values */
  plan: string;
};

/* The plan column is NOT NULL and holds one of four values, but it is plain
   text: an unrecognised one is shown capitalised rather than swallowed, because
   a plan nobody can name is a thing the owner should be able to read out over
   the phone. Mirrors lib/tiff/quota.ts's asPlan(), which makes the same bet in
   the other direction (unknown → the default allowance). */
const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  standard: "Standard",
  pro: "Pro",
  unlimited: "Unlimited",
};

export function planLabel(plan: string): string {
  const key = plan.trim().toLowerCase();
  return PLAN_LABELS[key] ?? (key ? key[0]!.toUpperCase() + key.slice(1) : "—");
}

/** "Isaac Smith", or "isaac" from isaac@… when the profile has no name yet. */
export function ownerLabel(account: OrgAccount): string {
  if (account.ownerName?.trim()) return account.ownerName.trim();
  const local = account.ownerEmail?.split("@")[0];
  return local?.trim() || "—";
}
