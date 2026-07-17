/* Design Studio — data packs, SERVER side (Stage 2 bridge).
   Reads pack JSON off disk and turns it into a validated, engine-ready-scored
   DataPack for (a) the Data Library browser and (b) resolving the packs a
   design pins. fs/path make this server-only — never import it into a client
   component; the Data Library page (a Server Component) imports it and passes
   plain serialisable data down to the client renderer.

   All fns take an optional `baseDir` so tests point at a fixture dir instead of
   the live `data/packs/` (which the extraction agent may be writing). */

import { promises as fs } from "fs";
import path from "path";
import { type PackMeta, type DataPack } from "./schema";
import { loadPackDir, resolvePacks, type SectionReader } from "./loader";
import { validatePack, type ValidationResult } from "./validate";
import { completenessByRange, type RangeCompleteness } from "./ready";

/** Repo-root pack directory. `process.cwd()` is the repo root under `next dev`.
    NOTE (prod): Vercel's file tracing may not bundle `data/packs/` into the
    serverless function — if this ever 404s in prod, add the dir to
    `outputFileTracingIncludes` in next.config, or switch to bundled imports. */
const DEFAULT_BASE = path.join(process.cwd(), "data", "packs");

/** Reads one section file's parsed array, or null when the file is absent. */
const fsReader: SectionReader = async (dir, section) => {
  try {
    const raw = await fs.readFile(path.join(dir, `${section}.json`), "utf8");
    return JSON.parse(raw) as unknown[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
};

async function readMeta(dir: string): Promise<PackMeta> {
  const raw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
  return JSON.parse(raw) as PackMeta;
}

export interface InstalledPackRef {
  brand: string;
  version: string;
  dir: string;
  meta: PackMeta;
}

/** Discover installed packs: every `<brand>@<version>/` dir holding a meta.json. */
export async function installedPacks(
  baseDir = DEFAULT_BASE
): Promise<InstalledPackRef[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return []; // no packs dir yet
  }
  const packs: InstalledPackRef[] = [];
  for (const name of entries.sort()) {
    const at = name.lastIndexOf("@");
    if (at <= 0) continue; // not a <brand>@<version> dir
    const dir = path.join(baseDir, name);
    let meta: PackMeta;
    try {
      meta = await readMeta(dir);
    } catch {
      continue; // no readable meta.json — skip
    }
    packs.push({ brand: name.slice(0, at), version: name.slice(at + 1), dir, meta });
  }
  return packs;
}

export interface LoadedPack {
  meta: PackMeta;
  pack: DataPack;
  validation: ValidationResult;
  completeness: RangeCompleteness[];
}

/** Load + migrate + validate + score one installed pack. */
export async function loadInstalledPack(
  brand: string,
  version: string,
  baseDir = DEFAULT_BASE
): Promise<LoadedPack> {
  const dir = path.join(baseDir, `${brand}@${version}`);
  const meta = await readMeta(dir);
  const pack = await loadPackDir(dir, meta, fsReader); // loadPackDir migrates
  return {
    meta,
    pack,
    validation: validatePack(pack),
    completeness: completenessByRange(pack),
  };
}

/** The packPins → live DataPack bridge. Loads each pinned pack and merges them
    (later wins), so the engine consumes ONE resolved DataPack for a design.
    Returns null when a design pins nothing yet.

    NOTE: this is the RAW loader (no HQ overrides). Engine callers that must
    reflect staff corrections should use `resolveDesignPacksWithOverrides`
    (overrides-server.ts). Kept override-free here so server.ts has no Supabase
    dependency (its jest suite runs without env). Currently unused in prod. */
export async function resolveDesignPacks(
  packPins: Record<string, string>,
  baseDir = DEFAULT_BASE
): Promise<DataPack | null> {
  const layers: DataPack[] = [];
  for (const [brand, version] of Object.entries(packPins)) {
    const { pack } = await loadInstalledPack(brand, version, baseDir);
    layers.push(pack);
  }
  return layers.length ? resolvePacks(layers) : null;
}
