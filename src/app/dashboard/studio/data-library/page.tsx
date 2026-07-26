import { redirect } from "next/navigation";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { installedPacks } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { DataLibrary, type PackView } from "@/components/studio/data-library";

/* Data Library — read-only view of the installed data packs (the universal
   table). ADMIN+, and role-intrinsic rather than grantable, same posture as
   the Admin section: this is the equipment data the whole business quotes
   off, and the PDF-upload / edit surface landing on this page is admin work
   by definition (universal-table-schema.md — Data Library). It was open to
   every signed-in member until 2026-07-26.

   Deliberately NOT also gated on `studio`: revoking someone's design canvas
   shouldn't decide whether they can read the equipment reference table, which
   only lives under /studio by URL. If a reason ever appears to give one senior
   tech the library without making them an admin, this becomes its own
   capability — see the same note in dashboard/admin/page.tsx.

   Read at request time so a freshly-extracted pack shows without a redeploy. */

export const dynamic = "force-dynamic";

export default async function DataLibraryPage() {
  if (!hasMinRole(await getDbRole(), "admin")) redirect("/dashboard");

  const refs = await installedPacks();
  const results = await Promise.allSettled(
    // override-aware so the library's readiness agrees with the studio engine
    refs.map((r) => loadPackWithOverrides(r.brand, r.version))
  );

  const packs: PackView[] = [];
  const failed: { brand: string; version: string; message: string }[] = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") packs.push(res.value);
    else
      failed.push({
        brand: refs[i].brand,
        version: refs[i].version,
        message: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
  });

  return <DataLibrary packs={packs} failed={failed} />;
}
