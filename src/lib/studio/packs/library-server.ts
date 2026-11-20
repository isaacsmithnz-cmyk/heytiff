import { installedPacks, type InstalledPackRef } from "./server";
import { loadPackWithOverrides } from "./overrides-server";
import { libraryManifest, type LibraryManifest } from "./library";

/* THE LIBRARY COMES WITH THE PAGE. The start screen lists what the studio
   can design with — brand, system, series, model — and says what arrived
   since this browser last looked. Read here, on the server, off the same
   disk and through the same override-aware loader the engine reads
   (`loadStudioPack`), so the listing and the unit browser agree.

   The newest installed version of each brand, as `latestInstalledPack`
   resolves it ("2026.1"-style versions sort lexically). A pack that fails to
   load is left out rather than taking the screen down: the home is for
   designing, and a pack's problems are checked in HQ's data pages. */
export async function studioLibrary(): Promise<LibraryManifest> {
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
