# VRF in the Studio

VRF joins split and multi in the zones → systems flow
(`docs/studio-zones-and-systems.md`). Isaac asked for it on 2026-09-28, which
lifts the 2026-09-16 "split and multi only" scope.

## Settled (Isaac, 2026-09-28)

- **v1 is PUHY-P200–500YNW-A1 heat pump only**, with City Multi heads. There
  are no combined modules (YSNW, twinning kits) and no heat recovery (R2, BC
  controllers).
- **The schematic replicates what is drawn on the plan.** A VRF's tree is the
  refrigerant runs as drawn: a joint sits wherever the drawn runs branch, and
  the editor's rail mirrors that tree. This differs from a multi, where the
  schematic is derived and never drawn. Until runs are drawn, the rail shows a
  provisional trunk through the zones in list order and says it is not drawn.
  An undrawn length is "not drawn", never 0 m.
- **PUMY is VRF** (joints to City Multi heads), but it is not in v1. It first
  needs its capacity index and its own pipe table, taken from the PUMY-SP book
  (M-P0860, already a pack source).

## The book is the oracle

Every figure comes from MEES21K029 (the PUHY-P-Y(S)NW-A1 Data Book) with its
page, never from memory or the web. Worked examples in the book are the
engine's tests (golden set D). The first one is the p.144 charge example:
PUHY-P350 with P125, P100, P40, P32 and P63 comes to 12.5 kg
(`src/lib/studio/__tests__/vrf-pack.test.ts`).

What the pack holds (`vrf_pipe_tables.json`, p.139-144):

- Pipe sizing:
  - ODU → 1st joint: the outdoor's own connection sizes (Table 1), with the
    liquid stepping up on P250 at L1 ≥ 90 m and on P300 at L1 ≥ 40 m.
  - Between joints: by total downstream index (Table 2).
  - Joint → indoor: by that unit's index (Table 3).
  - A downstream pipe is never larger than the one upstream (A ≥ B, A ≥ C ≥ D).
- Joints: chosen by downstream index. The 1st joint is chosen by outdoor
  (Table 4-2).
- Headers: chosen by branches and downstream index. The table also says which
  outdoors a header may join directly and which indoor sizes it can't take.
  Nothing branches after a header.
- Limits:
  - Total 1000 m.
  - Farthest 165 m actual / 190 m equivalent. Equivalent length = actual +
    M × bends, where M is set per outdoor.
  - After the 1st joint 40 m, or 90 m with the liquid one size up from where
    40 m is passed.
  - Outdoor above 50 m, below 40 m.
  - Indoor to indoor 15 m, or 30 m with those units' liquid one size up.
- Charge (`evaluateVrfCharge`):
  - Liquid metres per size × a rate. The rate band depends on whether the
    farthest indoor unit is within 30.5 m or beyond it.
  - Plus a fixed amount by total connected index (2.0–14.0 kg).
  - Plus named indoor units' own adders.
  - The total rounds up to 100 g.
- Envelope: connected index 50–130% of the outdoor's, `max_idus`, and each
  indoor unit between P10 and P250.

## Build order

1. **Pack data**: done in #896. The PUHY book's missing facts, a charge
   evaluator, and the p.144 charge test.
2. **Type, check, pick**: done in #897. A VRF outdoor makes the system a VRF
   whatever its head count. The check uses the outdoor's own index envelope.
   The proposal is the smallest PUHY that takes the heads, and the head list
   is City Multi units only.
3. **Tree and sizing**: done in #898.
   - `vrf-tree.ts` sizes every section and picks every joint and header.
   - `joints.ts` covers joints on the plan: a run landed on a run, and
     Draw > Joint.
   - The tree is read from the drawing once it reaches every head.
   - Golden D2 is p.144, both as a tree and as drawn.
4. **Limits and charge**: done in the step-4 PR.
   - Checks: total length, farthest actual and equivalent, outdoor above and
     below its heads, and the height step-up.
   - The charge on a drawn tree, checked against the outdoor's maximum
     (p.144, in `max_charge_kg`, the system total).
   - Red findings keep Done off.
5. **Paper**: joints, headers and pipe by size go on the picklist, the
   materials list and the sheet, with the charge on the sheet.

## Readings the book leaves open

These are recorded so they can be changed in one place.

- **Bends:** a bend is a corner drawn on a run: each vertex between a run's
  two ends. A riser is not counted as a bend.
- **Height step-up (5b):** the text says to step up "from the target units
  to the joint prior to which 15 m height difference has exceeded". Note *4
  steps up only the heads' own pipes (d, e, f, g), and the engine follows
  *4. The base level is the head nearest the outdoor's level.
- **Levels:** a level comes only from risers (their `heightM`). A unit's
  mounting height on its floor does not count.
