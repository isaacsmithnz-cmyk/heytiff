/* Design Studio — data packs (Stage 2). Public surface of the universal table:
   the schema types, the computed engine-ready flags, the validator (CI gate),
   and the merge-aware loader. See universal-table-schema.md. */

export * from "./schema";
export * from "./ready";
export * from "./validate";
export * from "./loader";
export * from "./migrations";
