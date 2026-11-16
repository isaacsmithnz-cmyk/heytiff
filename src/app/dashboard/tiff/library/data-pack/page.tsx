import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { libraryUnits } from "@/lib/library/packs-server";
import { packBrands, packKinds, sortUnits } from "@/lib/library/data-pack";
import { DataPack } from "@/components/tiff/data-pack";
import { Empty } from "@/components/parts/states";

/* DATA PACK, the Library's place for every unit in the data books
   (components/tiff/data-pack). Behind the Library's own `tiff` grant, as
   the Library page is; the packs are the Studio's, the same for every
   workspace. */
export default async function DataPackPage() {
  if (!(await can("tiff"))) redirect("/dashboard/tiff/library");
  const units = await libraryUnits()
    .then(sortUnits)
    .catch(() => null);
  if (!units)
    return (
      <div className="page in">
        <div className="wrap lb2">
          <Empty what="The data packs couldn't be read just now" line="Reload the page to try again." action={null} />
        </div>
      </div>
    );
  return <DataPack units={units} brands={packBrands(units)} kinds={packKinds(units)} />;
}
