# ADR-001 — Design Studio canvas renderer: SVG-in-React

**Status:** Accepted · 2026-07-05 · closes issue #14
**Context:** `design-studio-plan.md` Part 3 flags the renderer as a decide-once
choice at Stage 1 start — it shapes the whole object-rendering layer.

## Decision

The Design Studio scene graph renders as **SVG inside React components**. A
single `<g>` carries the pan/zoom transform; world coordinates are floor-plan
image pixels (blank canvases use the floor's explicit scale), matching the
harvested DUCTR convention. Strokes use `vector-effect: non-scaling-stroke`
(constant screen weight); labels scale inversely with zoom.

A dedicated `<canvas>` **overlay** is reserved for the Stage-12 simulation
layer (airflow particles) — high-frequency animation is the one workload SVG
is wrong for, and an overlay adds it without touching the scene graph.

## Reasons

1. **Scale of the problem.** HVAC designs are tens-to-hundreds of objects per
   floor, not thousands. SVG performance is a non-issue at this size.
2. **Hit-testing for free.** Every object is a DOM element with pointer
   events. The legacy app hand-rolled per-type hit tests (HARVEST §5) — an
   entire class of code we never write.
3. **Theming.** Object styles ride the host CSS custom properties like the
   rest of the shell; concealed-plane rendering (Stage 6) is `stroke-dasharray`
   + opacity, not custom draw code.
4. **Testability.** jsdom renders SVG; RTL can assert on the scene graph
   structure. The golden-test strategy (Part 4) stays engine-level, but
   component tests stay cheap too. A canvas renderer needs node-canvas mocks.
5. **Zero dependencies.** Konva/PixiJS add ~150KB+, an imperative scene API,
   and SSR quirks; we'd still write all the domain logic ourselves.
6. **Crisp at every zoom.** Vector output; print/export paths (Stage 4 PDF
   sheets) can reuse the same SVG rendering.

## Consequences

- Geometry/viewport math lives in pure modules (`src/lib/studio/geometry.ts`),
  framework-free like the harvested helpers it derives from.
- The renderer never mutates the document: it renders `DesignDocument` objects
  and emits intents; all mutation flows through the editor's `mutate()`.
- If a future workload exceeds SVG (huge imported plans, thousands of parts),
  the escape hatch is per-layer canvas rasterisation behind the same object
  model — the document schema is renderer-agnostic.
