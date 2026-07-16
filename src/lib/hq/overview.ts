/* HQ overview — pure reducers over the platform tables.

   The queries stay flat (three plain selects, no PostgREST embedded aggregates)
   and the shaping happens here so it unit-tests without a database. Data volumes
   are tiny (a handful of orgs) so an in-memory join is the simplest thing that
   works and carries no PostgREST-version risk. */

export interface OrgRow {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  designCount: number;
  /** most recent studio activity (max design updated_at), or null if none */
  lastActivity: string | null;
}

export interface MemberRow {
  userId: string;
  role: string;
  joinedAt: string;
  email: string | null;
  name: string | null;
  lastLoginAt: string | null;
  /** false when the user hasn't logged in since profiles went live */
  hasProfile: boolean;
}

type OrgIn = { id: string; name: string; created_at: string };
type MembershipIn = { org_id: string; user_id: string };
type DesignIn = { org_id: string; updated_at: string };

/** One row per org: member + design counts and last studio activity, newest first. */
export function buildOrgRows(
  orgs: OrgIn[],
  memberships: MembershipIn[],
  designs: DesignIn[]
): OrgRow[] {
  const members = new Map<string, number>();
  for (const m of memberships) members.set(m.org_id, (members.get(m.org_id) ?? 0) + 1);

  const designCount = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  for (const d of designs) {
    designCount.set(d.org_id, (designCount.get(d.org_id) ?? 0) + 1);
    const cur = lastActivity.get(d.org_id);
    if (!cur || d.updated_at > cur) lastActivity.set(d.org_id, d.updated_at);
  }

  return orgs
    .map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      memberCount: members.get(o.id) ?? 0,
      designCount: designCount.get(o.id) ?? 0,
      lastActivity: lastActivity.get(o.id) ?? null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

type MemberIn = { user_id: string; role: string; created_at: string };
type ProfileIn = {
  user_id: string;
  email: string | null;
  name: string | null;
  last_login_at: string | null;
};

/** Left-join memberships → profiles (profiles backfill only as users log in, so
    a membership may have no profile row yet — tolerated, never dropped). */
export function joinMembersToProfiles(
  members: MemberIn[],
  profiles: ProfileIn[]
): MemberRow[] {
  const byId = new Map<string, ProfileIn>();
  for (const p of profiles) byId.set(p.user_id, p);

  return members
    .map((m) => {
      const p = byId.get(m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
        joinedAt: m.created_at,
        email: p?.email ?? null,
        name: p?.name ?? null,
        lastLoginAt: p?.last_login_at ?? null,
        hasProfile: !!p,
      };
    })
    .sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : 0));
}
