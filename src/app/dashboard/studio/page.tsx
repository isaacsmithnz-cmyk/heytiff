import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { isProviderConnected } from "@/lib/integrations/store";
import { orgBrand } from "@/lib/org/query";
import { BRAND_TTL_S, NO_BRAND } from "@/lib/org/brand";
import { Studio } from "@/components/studio/studio";

// `studio` is on by default for every role but revocable — gate the route,
// not just the nav entry.
export default async function StudioPage({
  searchParams,
}: {
  /* `?design=<id>` — what a link from elsewhere in the app opens. Read on the
     SERVER and handed down, rather than with `useSearchParams` in the client:
     that hook forces a Suspense boundary around the page, and the profile
     screen already sets this precedent for the same reason. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await can("studio"))) redirect("/dashboard");

  /* Whether the new-design step offers "start from a ServiceM8 job" is
     decided HERE, not by the search coming back empty: an empty search means
     "no such job", and a workspace with no ServiceM8 at all should be shown
     no box rather than a box that can never find anything. Both halves are
     asked — the mirror needs a connection, and reading the client book needs
     `workboard`, the same gate the Workboard's own job picker holds. */
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  /* THE LETTERHEAD COMES WITH THE PAGE. The Summary sheet is a document with
     the business's mark on it and, if they have chosen a colour, a frame in
     it — and both used to be asked for from the browser at the moment the
     sheet mounted, so the document arrived plain and then re-laid itself out
     around a frame that appeared a second later. Read here it is simply part
     of the page, at the cost of nothing: this await runs beside the two that
     were already here, so the route waits for the slowest, not the sum.

     Signed for the same window the client re-signs for (see useOrgBrand), and
     asked for only when there is a session to ask with — the redirect above
     has already turned away anyone without one. */
  const [sm8Connected, boardAccess, params, brand] = await Promise.all([
    orgId ? isProviderConnected(orgId, "servicem8") : Promise.resolve(false),
    can("workboard"),
    searchParams,
    orgId ? orgBrand(orgId, { seconds: BRAND_TTL_S }) : Promise.resolve(NO_BRAND),
  ]);

  /* The id is a CHOICE handed in by whoever followed the link, so nothing
     here trusts it: the store re-resolves it inside this org and a design
     that isn't there simply isn't opened. */
  const asked = params.design;
  const openDesignId = typeof asked === "string" && asked ? asked : undefined;

  return (
    <Studio
      sm8Jobs={sm8Connected && boardAccess}
      openDesignId={openDesignId}
      brand={brand}
    />
  );
}
