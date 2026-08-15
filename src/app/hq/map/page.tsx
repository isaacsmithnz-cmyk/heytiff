import { requireHqPage } from "@/lib/hq/guard";
import { SystemMap } from "@/components/hq/system-map";

/* /hq/map — the living family tree of the platform: every feature, engine and
   data store, and the labelled wires between them. Content comes entirely from
   the registry in src/lib/hq/system-map.ts; extend the map there. */

export default async function HqMapPage() {
  await requireHqPage();

  return (
    <main className="hq-main hq-map-main">
      <h1 className="hq-h1">System map</h1>
      <p className="hq-lede">
        How the platform hangs together — what people use, the shared engines
        underneath, and where the data lives.
      </p>
      <SystemMap />
    </main>
  );
}
