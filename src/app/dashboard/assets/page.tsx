import { redirect } from "next/navigation";
import { AssetsScreen } from "@/components/fleet/assets-screen";
import { linkedScreen } from "@/components/fleet/vehicle-modal/derive";
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
  const [{ own, register, today, warnDays, viewerStaffId }, params] = await Promise.all([
    loadFleetPage({ withRegister: true }),
    searchParams,
  ]);
  if (!register) redirect("/dashboard/my-vehicle");

  /* `?v=` opens that vehicle's card, and `?screen=` the card's own screen for
     a renewal or a service (`?v=<id>&screen=rego`). A staff card's plate, the
     bell's fleet rows and Home's Renew are the callers. Read here rather than
     with useSearchParams, which would put the register behind a Suspense
     boundary it doesn't otherwise need. Someone without `assets_all` has
     already been sent to their own vehicle above, which is the right landing
     for them.

     A FRESH OBJECT PER RENDER, the Workboard's `?job=` contract: the screen
     takes a link by identity, so the same vehicle named twice (the bell,
     opened while standing on Assets) opens twice, and the screen takes the
     link out of the address once it has landed, so a save that revalidates
     this page renders without it. A `screen` it doesn't name opens the card
     on its main screen. */
  const v = params.v;
  const openVehicle =
    typeof v === "string" && v ? { id: v, screen: linkedScreen(params.screen) } : null;

  return (
    <AssetsScreen
      own={own}
      register={register}
      today={today}
      warnDays={warnDays}
      viewerStaffId={viewerStaffId}
      openVehicle={openVehicle}
    />
  );
}
