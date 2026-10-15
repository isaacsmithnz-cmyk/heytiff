import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { AirflowGuide, GuideMeta } from "./airflow";

/* The ducted airflow guide, read off disk (data/guides/airflow@<version>/),
   as studio/packs/server.ts reads the packs: the newest version installed.
   Every business reads the same guide; it changes only with a deploy, so
   it's read once a server. A route that reads it lists the folder in
   next.config's outputFileTracingIncludes, or Vercel never bundles it and
   the guide is simply not there. */

const DEFAULT_BASE = path.join(process.cwd(), "data", "guides");
const PREFIX = "airflow@";

/** The newest installed edition ("2026.1"-style, so lexical order is version order). */
export async function latestAirflowGuideDir(baseDir = DEFAULT_BASE): Promise<{ version: string; dir: string } | null> {
  let names: string[];
  try {
    names = await fs.readdir(baseDir);
  } catch {
    return null;
  }
  const version = names
    .filter((n) => n.startsWith(PREFIX))
    .map((n) => n.slice(PREFIX.length))
    .sort()
    .at(-1);
  return version ? { version, dir: path.join(baseDir, `${PREFIX}${version}`) } : null;
}

async function read(baseDir: string): Promise<AirflowGuide | null> {
  const at = await latestAirflowGuideDir(baseDir);
  if (!at) return null;
  const json = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(at.dir, file), "utf8")) as T;
  try {
    const [meta, flex, outlets, ret, ducts, zoning] = await Promise.all([
      json<GuideMeta>("meta.json"),
      json<AirflowGuide["flex"]>("flex_duct.json"),
      json<AirflowGuide["outlets"]>("supply_outlets.json"),
      json<AirflowGuide["ret"]>("return_air.json"),
      json<AirflowGuide["ducts"]>("ducts.json"),
      json<AirflowGuide["zoning"]>("zoning.json"),
    ]);
    return { meta, flex, outlets, ret, ducts, zoning };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

const cache = new Map<string, Promise<AirflowGuide | null>>();

/** The guide, or null when none is installed. */
export function loadAirflowGuide(baseDir = DEFAULT_BASE): Promise<AirflowGuide | null> {
  let got = cache.get(baseDir);
  if (!got) {
    got = read(baseDir);
    /* a failed read isn't kept: the next call tries again */
    got.catch(() => cache.delete(baseDir));
    cache.set(baseDir, got);
  }
  return got;
}
