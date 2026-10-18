import { notFound, redirect } from "next/navigation";
import { loadVehiclePage } from "@/lib/fleet/vehicle-page-data";
import { parseVehicleSection, sectionsFor } from "@/lib/fleet/vehicle-page";
import { VehiclePage } from "@/components/fleet/vehicle-page/vehicle-page";

/* ONE VEHICLE, A PAGE OF ITS OWN (v2, "A vehicle's own page", 18 October,
   Isaac: "Looks good"), inside the dashboard frame: its name and rego, one
   grey line and its state as a word, Add and Actions, and its sections.

   Gated as today's vehicle card is: `assets_all` opens any vehicle in the
   org, the register's way; a driver without it opens the vehicle assigned
   to them, read-only where My vehicle is read-only. Every other id (another
   org's, a pool ute the driver isn't assigned, nothing at all) is a 404,
   not a leak. See lib/fleet/vehicle-page-data.

   `?tab=` names the section: one this viewer has, else Overview.

   Awaits the request on purpose: under the dashboard's loading.tsx the
   frame paints at once and this streams in behind it. */

export default async function VehiclePageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const data = await loadVehiclePage(id.slice(0, 80));
  if (data === "signed-out") redirect("/dashboard");
  if (!data) notFound();

  const sections = sectionsFor({ register: data.lens === "register", motorised: data.vehicle.motorised });
  const section = parseVehicleSection(search.tab, sections);
  return <VehiclePage data={data} sections={sections} section={section} />;
}
