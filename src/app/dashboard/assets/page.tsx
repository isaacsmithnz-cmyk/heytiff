import { redirect } from "next/navigation";
import { AssetsScreen } from "@/components/fleet/assets-screen";
import { loadFleetPage } from "@/lib/fleet/page-data";

/* Assets is the register, so it gates on `assets_all`. It was ungated until
   now only because it was also a staff member's single path to their own
   vehicle; /dashboard/my-vehicle is that path from this stage on, so someone
   without the capability is sent there rather than to a lens-shaped Assets. */

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ own, register, today, viewerStaffId }, params] = await Promise.all([
    loadFleetPage({ withRegister: true }),
    searchParams,
  ]);
  if (!register) redirect("/dashboard/my-vehicle");

  /* `?v=` — read here rather than with useSearchParams, which would put the
     register behind a Suspense boundary it doesn't otherwise need. A staff
     card's plate links in this way; the register opens that vehicle once and
     then owns its own modal. Someone without `assets_all` has already been
     sent to their own vehicle above, which is the right landing for them. */
  const v = params.v;

  return (
    <AssetsScreen
      own={own}
      register={register}
      today={today}
      viewerStaffId={viewerStaffId}
      openVehicleId={typeof v === "string" ? v : null}
    />
  );
}
