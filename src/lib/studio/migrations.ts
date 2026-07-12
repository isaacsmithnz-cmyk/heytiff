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

/** Keyed by the version the migration upgrades FROM. */
const MIGRATIONS: Record<number, Migration> = {
  /* v1 → v2: floors carried a single `plan` (image ref + size); v2 floors
     carry `plans: PlanSheet[]` so one level can span several sheets
     (east/west wings) positioned in the floor's world space. */
  1: (doc) => {
    const floors = (doc.floors as Record<string, unknown>[]).map((f) => {
      const plan = f.plan as
        | {
            imageRef: string;
            pageNumber: number | null;
            width?: number;
            height?: number;
          }
        | null
        | undefined;
      const rest = { ...f };
      delete rest.plan;
      return {
        ...rest,
        plans: plan
          ? [
              {
                id: `sht_${f.id}`,
                imageRef: plan.imageRef,
                pageNumber: plan.pageNumber ?? null,
                name: (f.name as string) ?? "Plan",
                width: plan.width ?? 0, // 0 = unknown; canvas measures on load
                height: plan.height ?? 0,
                x: 0,
                y: 0,
              },
            ]
          : [],
      };
    });
    return { ...doc, floors, schemaVersion: 2 };
  },

  /* v2 → v3: documents can belong to a design-variation set (Option 1/2/3…).
     Pre-v3 documents aren't part of any set. */
  2: (doc) => {
    const meta = doc.meta as Record<string, unknown>;
    return {
      ...doc,
      meta: { ...meta, variantLabel: null },
      variants: [],
      schemaVersion: 3,
    };
  },

  /* v3 → v4: floors that were auto-labelled with their source plan's page name
     ("Page 6") are renamed to their STACK POSITION — the label was the drawing,
     not the floor. Only the auto "Page N" pattern is touched; custom names are
     left alone. (Matches defaultFloorName() in plans.ts.) */
  3: (doc) => {
    const floorName = (level: number) =>
      level < 0 ? `Basement ${-level}` : level === 0 ? "Ground floor" : `Level ${level}`;
    const floors = (doc.floors as Record<string, unknown>[]).map((f) => {
      const name = typeof f.name === "string" ? f.name.trim() : "";
      return /^page \d+$/i.test(name)
        ? { ...f, name: floorName(typeof f.level === "number" ? f.level : 0) }
        : f;
    });
    return { ...doc, floors, schemaVersion: 4 };
  },

  /* v4 → v5: the plan-upload session is now persisted (every uploaded page +
     selection + names) so the Plans step restores on return. Pre-v5 documents
     never captured it — the raw pages weren't stored, so there is nothing to
     restore for them; they open with no session. */
  4: (doc) => ({ ...doc, planImport: null, schemaVersion: 5 }),

  /* v5 → v6: floors gain `northPos` — where the placeable north arrow sits on
     the plan (`northDeg` already held the bearing but nothing wrote it). No
     pre-v6 floor placed an arrow, so it starts null. (`PlanSheet.crop` is
     optional and simply absent on old sheets — no touch needed.) */
  5: (doc) => {
    const floors = (doc.floors as Record<string, unknown>[]).map((f) => ({
      ...f,
      northPos: null,
    }));
    return { ...doc, floors, schemaVersion: 6 };
  },
};

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
