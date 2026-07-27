import { cache } from "react";
import { auth0 } from "@/lib/auth0";
import { getCapabilities, getOrgLogoRef, getOrgName, getOwnership } from "@/lib/permissions-server";
import { signOne } from "@/lib/documents/query";
import { getViewerName } from "@/lib/staff/query";
import { ownerLabel } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import type { ShellUser } from "@/components/shell/sidebar";

/* Everything the app frame needs to know about WHO is looking at it.

   This used to be awaited at the top of the dashboard layout, which made the
   layout itself the thing every screen waited on. Under Cache Components that
   is also a build error — uncached data outside a Suspense boundary blocks the
   whole route from prerendering — so it moved here and the layout now passes
   the PROMISE down instead of the value. The frame renders immediately; the
   sidebar and topbar stream into it.

   None of it is cacheable: it is one specific person's name, role, and
   capability set. The point isn't to cache it, it's to stop the black frame
   and the page skeleton from waiting on it. */

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", // overridden to "Co-owner" for owners who aren't the master
  admin: "Admin",
  staff: "Staff",
};

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export type ShellData = {
  user: ShellUser;
  orgName: string | null;
  orgLogoUrl: string | null;
};

/* React-cached: the sidebar, the topbar and the command palette are three
   separate server components now (so they can suspend independently), and all
   three ask for this. One execution per request, three readers. */
export const loadShell = cache(async (): Promise<ShellData> => {
  const session = await auth0.getSession();
  const email = session?.user?.email ?? "";
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const fallbackName = (session?.user?.name as string) || email.split("@")[0] || "User";

  /* The name read and the membership read are independent — one asks
     staff_profiles who this is, the other asks memberships what they may do —
     so they go out together. getOwnership/getCapabilities/getOrgName/
     getOrgLogoRef all share ONE request-cached membership query.

     The staff record owns the name: the Auth0 session has no name claim here,
     and trusting it showed people their own email address in the topbar. */
  const [viewer, ownership, caps, orgName, logoRef] = await Promise.all([
    orgId && userId
      ? getViewerName(orgId, userId, fallbackName)
      : Promise.resolve({ full: fallbackName, first: "there" }),
    getOwnership(),
    getCapabilities(),
    getOrgName(),
    getOrgLogoRef(),
  ]);

  const displayName = viewer.full;
  const orgRole = ownership.role ?? "";

  return {
    user: {
      name: displayName,
      roleLabel: ownerLabel(ownership) ?? ROLE_LABEL[orgRole] ?? "Member",
      initials: initialsFrom(displayName || email || "U"),
      role: (orgRole as Role) || null,
      // resolved per request, so a granted capability shows its nav entry on
      // the very next navigation — no re-login
      caps: [...caps],
    },
    orgName,
    // signed here because the bucket is private and a stored URL would be one
    // that stops working; skipped entirely when there is no logo
    orgLogoUrl: await signOne(logoRef),
  };
});
