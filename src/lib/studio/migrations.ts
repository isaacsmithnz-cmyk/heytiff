/* Design Studio — schema versioning + migrations.
   Every schema bump ships a migration; opening a document runs the chain from
   its stored version up to SCHEMA_VERSION. Golden documents from every prior
   version must open (design-studio-plan.md, Part 4 §5) — the migration tests
   enforce that. */

import {
  SCHEMA_VERSION,
  isDesignDocumentShape,
  type DesignDocument,
} from "./document";

/** A migration takes a document at version N and returns it at N+1.
    Input is loosely typed on purpose — old shapes no longer exist in TS. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version the migration upgrades FROM.
    v1 is the first schema, so the registry starts empty. Example of a future
    entry: `1: (doc) => ({ ...doc, newField: default, schemaVersion: 2 })`. */
const MIGRATIONS: Record<number, Migration> = {};

export class DesignDocumentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not-json"
      | "not-a-design"
      | "future-version"
      | "missing-migration"
  ) {
    super(message);
    this.name = "DesignDocumentError";
  }
}

/** Open a raw parsed value as a design document, migrating as needed.
    Returns the document at SCHEMA_VERSION plus whether it was migrated. */
export function migrateDesign(raw: unknown): {
  doc: DesignDocument;
  migratedFrom: number | null;
} {
  if (!isDesignDocumentShape(raw)) {
    throw new DesignDocumentError(
      "Not a HeyTiff design document",
      "not-a-design"
    );
  }
  const startVersion = raw.schemaVersion;
  if (startVersion > SCHEMA_VERSION) {
    throw new DesignDocumentError(
      `Design was saved by a newer version of the studio (schema v${startVersion}, this app reads up to v${SCHEMA_VERSION})`,
      "future-version"
    );
  }
  let doc = raw as unknown as Record<string, unknown>;
  for (let v = startVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      throw new DesignDocumentError(
        `No migration from schema v${v}`,
        "missing-migration"
      );
    }
    doc = step(doc);
    if ((doc.schemaVersion as number) !== v + 1) {
      throw new DesignDocumentError(
        `Migration from v${v} did not bump schemaVersion`,
        "missing-migration"
      );
    }
  }
  return {
    doc: doc as unknown as DesignDocument,
    migratedFrom: startVersion < SCHEMA_VERSION ? startVersion : null,
  };
}

/** Parse a JSON string into a current-version design document. */
export function openDesignJson(json: string): {
  doc: DesignDocument;
  migratedFrom: number | null;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new DesignDocumentError("File is not valid JSON", "not-json");
  }
  return migrateDesign(raw);
}
