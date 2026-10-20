import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { vehiclePageHref } from "@/lib/shell/links";

/* Retired (v2 audit, 20 October 2026): the register is Team's Vehicles
   view, and a vehicle opens on its own page, on Service when the old door
   (`?v=<id>&screen=add:service`) asked to add one. Someone without the
   register has /dashboard/my-vehicle, their own vehicle, as before. */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<never> {
  if (!(await can("assets_all"))) redirect("/dashboard/my-vehicle");
  const params = await searchParams;
  const named = typeof params.v === "string" ? params.v : "";
  if (named) redirect(vehiclePageHref(named, params.screen === "add:service" ? "service" : undefined));
  redirect("/dashboard/team?view=vehicles");
}
