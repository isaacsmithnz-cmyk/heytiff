/* Rebuild the ducted airflow guide's tables from its evidence.

     node scripts/build-airflow-guide.mts [version]     (npm run guide:airflow)

   Reads data/guides/airflow@<version>/evidence/*.json (the newest version
   when none is named), works every table out the same way each time
   (src/lib/guides/airflow-build.ts) and writes them beside meta.json.
   meta.json is the guide's own and isn't touched. The same evidence always
   writes the same bytes; a jest test rebuilds and compares, so a table
   edited by hand, or evidence changed without a rebuild, fails it. */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAirflowGuide, EVIDENCE_FILES, formatGuideJson, type Evidence } from "../src/lib/guides/airflow-build.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "guides");
const versions = readdirSync(root)
  .filter((n) => n.startsWith("airflow@"))
  .map((n) => n.slice("airflow@".length))
  .sort();
const version = process.argv[2] ?? versions.at(-1);
if (!version || !versions.includes(version)) {
  console.error(`No data/guides/airflow@${version ?? "<version>"}. Have: ${versions.join(", ") || "none"}`);
  process.exit(1);
}
const dir = join(root, `airflow@${version}`);
const evidence = Object.fromEntries(Object.entries(EVIDENCE_FILES).map(([key, file]) => [key, JSON.parse(readFileSync(join(dir, "evidence", file), "utf8"))])) as Evidence;

for (const [file, table] of Object.entries(buildAirflowGuide(evidence))) {
  writeFileSync(join(dir, file), formatGuideJson(table));
  console.log(`wrote ${file}`);
}
