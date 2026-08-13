import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { isProviderConnected } from "@/lib/integrations/store";
import { Studio } from "@/components/studio/studio";

// `studio` is on by default for every role but revocable — gate the route,
// not just the nav entry.
export default async function StudioPage() {
  if (!(await can("studio"))) redirect("/dashboard");

  /* Whether the new-design step offers "start from a ServiceM8 job" is
     decided HERE, not by the search coming back empty: an empty search means
     "no such job", and a workspace with no ServiceM8 at all should be shown
     no box rather than a box that can never find anything. Both halves are
     asked — the mirror needs a connection, and reading the client book needs
     `workboard`, the same gate the Workboard's own job picker holds. */
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const [sm8Connected, boardAccess] = await Promise.all([
    orgId ? isProviderConnected(orgId, "servicem8") : Promise.resolve(false),
    can("workboard"),
  ]);

  return <Studio sm8Jobs={sm8Connected && boardAccess} />;
}
