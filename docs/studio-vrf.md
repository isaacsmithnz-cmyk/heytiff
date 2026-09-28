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

1. **Pack data**: done. It covers the extraction above, schema, validation,
   the charge evaluator and the p.144 test.
2. **Type, check, pick.**
   - A VRF outdoor types the system `vrf` whatever the head count. Today the
     2+ heads → multi rule runs first.
   - The verdict judges the envelope by index, not by pair.
   - The outdoor is proposed by Σ index inside the ratio band.
   - The head list is `vrf-idu`-ready City Multi units.
3. **Tree and sizing.**
   - Graph v1: junction nodes where drawn runs branch, and downstream index
     per segment.
   - Pipe size per segment, joint and header parts, and the upsizing rules.
   - The rail shows real sizes and part numbers.
4. **Limits and charge.**
   - Lengths per path from the drawn runs and risers, with bends counted for
     equivalent length.
   - Lift checks, and the charge from the sized network.
5. **Paper.** Joints, headers and pipe by size go on the picklist, the
   materials list and the sheet.
