import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { isProviderConnected } from "@/lib/integrations/store";
import { orgBrand } from "@/lib/org/query";
import { BRAND_TTL_S, NO_BRAND } from "@/lib/org/brand";
import { installedPacks, type InstalledPackRef } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { libraryManifest, type LibraryManifest } from "@/lib/studio/packs/library";
import { Studio } from "@/components/studio/studio";
import { StudioKeep } from "@/components/studio/studio-keeper";
import { readJobDesigns, studioJobOf } from "@/lib/studio/job-designs-server";
import { prefillFromJob, type JobPrefill } from "@/lib/studio/job-link";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { designHref } from "@/lib/shell/links";

/* THE LIBRARY COMES WITH THE PAGE. The start screen lists what the studio
   can design with — brand, system, series, model — and says what arrived
   since this browser last looked. Read here, on the server, off the same
   disk and through the same override-aware loader the engine reads
   (`loadStudioPack`), so the listing and the unit browser agree.

   The newest installed version of each brand, as `latestInstalledPack`
   resolves it ("2026.1"-style versions sort lexically). A pack that fails to
   load is left out rather than taking the screen down: the home is for
   designing, and a pack's problems are checked in HQ's data pages. */
async function studioLibrary(): Promise<LibraryManifest> {
  const latest = new Map<string, InstalledPackRef>();
  for (const ref of await installedPacks()) {
    const cur = latest.get(ref.brand);
    if (!cur || ref.version.localeCompare(cur.version) > 0) latest.set(ref.brand, ref);
  }
  const results = await Promise.allSettled(
    [...latest.values()].map(async (ref) => {
      const { meta, pack } = await loadPackWithOverrides(ref.brand, ref.version);
      return { meta, pack };
    })
  );
  const packs = [];
  for (const r of results) if (r.status === "fulfilled") packs.push(r.value);
  return libraryManifest(packs);
}

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
  const [sm8Connected, boardAccess, params, brand, library] = await Promise.all([
    orgId ? isProviderConnected(orgId, "servicem8") : Promise.resolve(false),
    can("workboard"),
    searchParams,
    orgId ? orgBrand(orgId, { seconds: BRAND_TTL_S }) : Promise.resolve(NO_BRAND),
    studioLibrary(),
  ]);

  /* The id is a CHOICE handed in by whoever followed the link, so nothing
     here trusts it: the store re-resolves it inside this org and a design
     that isn't there simply isn't opened. */
  const asked = params.design;
  const openDesignId = typeof asked === "string" && asked ? asked : undefined;

  /* `?job=<id>` — THE QUOTE'S DESIGN STEP (Isaac, 28 October 2026: "with
     the Studio opening from the Design step"). The job's newest design
     opens, as its own link would; with none, New design opens on the job,
     its street for the name and no job to search for. The id is re-resolved
     inside this org (a claim opens its parent), and reading the job needs
     the Workboard, as the job search does. `&new` is the job's Design
     section's New design: New design on the job, whatever it has already. */
  const askedJob = typeof params.job === "string" ? params.job.trim().slice(0, 80) : "";
  const askedNew = params.new !== undefined;
  let forJob: JobPrefill | undefined;
  if (askedJob && !openDesignId && orgId && boardAccess) {
    const target = await resolveJobCard(orgId, askedJob);
    const [newest] = askedNew ? [] : await readJobDesigns(orgId, target.parentRemoteId, 1);
    if (newest) redirect(designHref(newest.id));
    const hit = await studioJobOf(orgId, target.parentRemoteId);
    if (hit) forJob = prefillFromJob(hit);
  }

  /* Which deployment served this page. `VERCEL_DEPLOYMENT_ID` is the same
     value Skew Protection keys on, and it is read HERE because only the server
     can see it. The client uses it for one purpose: noticing that a tab has
     come back on a different build than it left on. Empty off Vercel, or when
     the project's "Enable access to System Environment Variables" box is
     unchecked — the breadcrumb then says it cannot tell, rather than guessing. */
  const buildStamp =
    process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";

  /* handed to the keeper, which draws it beside the pages and keeps it
     alive behind other tabs (studio-keeper.tsx) */
  return (
    <StudioKeep design={openDesignId} job={forJob?.remoteId}>
      <Studio
        sm8Jobs={sm8Connected && boardAccess}
        openDesignId={openDesignId}
        forJob={forJob}
        buildStamp={buildStamp}
        brand={brand}
        library={library}
      />
    </StudioKeep>
  );
}
