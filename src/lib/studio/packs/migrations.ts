/* Design Studio — data-pack schema versioning + migrations (Stage 2 seam).
   Mirrors the document migrations (../migrations.ts) but for PACK shape. This
   is the insurance that lets heavy future systems (heat-recovery 3-pipe VRF,
   new brands) grow the shared schema WITHOUT touching designs already pinned to
   an older pack version: a design keeps its pinned pack; only when a pack is
   re-resolved at a newer schema does the chain run.

   Discipline this enforces: shared-schema growth is additive (new OPTIONAL
   fields) and every bump ships a migration. `emptyPack`/valid packs at any
   prior version must upgrade cleanly — the tests below are the lock. */

import { PACK_SCHEMA_VERSION, type DataPack } from "./schema";

/** Upgrades a pack from version N to N+1. Loosely typed on purpose — old pack
    shapes no longer exist in TS. MUST bump `meta.packSchemaVersion`. */
export type PackMigration = (
  pack: Record<string, unknown>
) => Record<string, unknown>;

/** Keyed by the version the migration upgrades FROM. Empty today (v1 is the
    first shape); the first schema growth (e.g. HR fields → v2) registers `1:`. */
export const PACK_MIGRATIONS: Record<number, PackMigration> = {};

export class DataPackError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not-a-pack"
      | "future-version"
      | "missing-migration"
  ) {
    super(message);
    this.name = "DataPackError";
  }
}

function versionOf(raw: Record<string, unknown>): number {
  const meta = raw.meta as Record<string, unknown> | undefined;
  const v = meta?.packSchemaVersion;
  return typeof v === "number" ? v : NaN;
}

/** Cheap structural guard — is this a data pack at all? */
export function isDataPackShape(v: unknown): v is DataPack {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.meta === "object" &&
    p.meta !== null &&
    Number.isFinite(versionOf(p)) &&
    Array.isArray(p.outdoor_units) &&
    Array.isArray(p.indoor_units)
  );
}

/** Pure chain runner — injectable migrations + target so the multi-step logic
    is testable without inventing a real migration (there are none yet). */
export function runPackMigrations(
  raw: Record<string, unknown>,
  migrations: Record<number, PackMigration>,
  target: number
): { pack: Record<string, unknown>; migratedFrom: number | null } {
  const start = versionOf(raw);
  if (start > target) {
    throw new DataPackError(
      `Pack was built by a newer schema (v${start}, this app reads up to v${target})`,
      "future-version"
    );
  }
  let pack = raw;
  for (let v = start; v < target; v++) {
    const step = migrations[v];
    if (!step) {
      throw new DataPackError(`No pack migration from schema v${v}`, "missing-migration");
    }
    pack = step(pack);
    if (versionOf(pack) !== v + 1) {
      throw new DataPackError(
        `Pack migration from v${v} did not bump packSchemaVersion`,
        "missing-migration"
      );
    }
  }
  return { pack, migratedFrom: start < target ? start : null };
}

/** Open an assembled pack, migrating it up to the current schema. Run this at
    the load boundary (loader.loadPackDir does) before validation. */
export function migratePack(raw: unknown): {
  pack: DataPack;
  migratedFrom: number | null;
} {
  if (!isDataPackShape(raw)) {
    throw new DataPackError("Not a Design Studio data pack", "not-a-pack");
  }
  const { pack, migratedFrom } = runPackMigrations(
    raw as unknown as Record<string, unknown>,
    PACK_MIGRATIONS,
    PACK_SCHEMA_VERSION
  );
  return { pack: pack as unknown as DataPack, migratedFrom };
}
