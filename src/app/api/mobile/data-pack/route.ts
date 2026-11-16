import { libraryUnits } from "@/lib/library/packs-server";
import { packBrands, packKinds, sortUnits } from "@/lib/library/data-pack";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* DATA PACK for the phone's Library: every unit in the data books, smallest
   first, with the brands and kinds its filters offer (lib/library/data-pack).
   The phone filters and compares on its own; Combine asks /combine, where
   the packs are. Behind the Library's own `tiff` grant. Read from the packs
   the Studio designs with, the same for every workspace: nothing here is a
   workspace's own. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const units = sortUnits(await libraryUnits());
  return ok({ units, brands: packBrands(units), kinds: packKinds(units) });
}
