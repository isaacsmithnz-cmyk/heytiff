/** @jest-environment node */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { findWalls, scaleWalls, wallsByShade } from "../walls";

/* THE KEPT TEST against a real set with a known answer. A set is a
   customer's drawing, so it is never in the repo: point PLAN_EVAL at a
   folder holding `pages/p<n>.png` (drawn by scripts/plan-eval-draw.mjs at 2
   pixels per PDF point) and `key/grid<n>.json` (the wall lines found by
   hand, in those pixels) and this scores the measuring against it. Without
   PLAN_EVAL it is skipped.

     PLAN_EVAL=~/Developer/heytiff-plan-eval/3570 npx jest eval-set */
const DIR = process.env.PLAN_EVAL ?? "";
const have = DIR && existsSync(path.join(DIR, "pages"));

(have ? describe : describe.skip)(
  "a real set's walls, against its answer key",
  () => {
    const pages = [9, 10, 11].filter((n) =>
      existsSync(path.join(DIR, "key", `grid${n}.json`)),
    );
    it.each(pages)(
      "page %i's wall lines",
      async (n) => {
        const key = JSON.parse(
          readFileSync(path.join(DIR, "key", `grid${n}.json`), "utf8"),
        ) as { X: number[]; Y: number[] };
        const { data, info } = await sharp(path.join(DIR, "pages", `p${n}.png`))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const t0 = Date.now();
        if (process.env.PLAN_EVAL_SHADES)
          console.log(
            JSON.stringify(
              wallsByShade(data, info.width, info.height, null).map((w) => ({
                shade: w.shade,
                segs: w.segs.length,
                run: w.run,
                t: [...new Set(w.segs.map((x) => Math.round(x.t)))]
                  .sort((a, b) => a - b)
                  .slice(0, 12),
              })),
            ),
          );
        const found = findWalls(data, info.width, info.height, null);
        expect(found).not.toBeNull();
        const w = scaleWalls(found!, 1);
        const hit = (want: number[], got: number[]) =>
          want.filter((v) => got.some((g) => Math.abs(g - v) <= 6)).length;
        const out = {
          n,
          ms: Date.now() - t0,
          shade: w.shade,
          segs: w.segs.length,
          x: `${hit(key.X, w.grid.x)}/${key.X.length} (found ${w.grid.x.length})`,
          y: `${hit(key.Y, w.grid.y)}/${key.Y.length} (found ${w.grid.y.length})`,
        };
        console.log(JSON.stringify(out));
        if (process.env.PLAN_EVAL_SHADES)
          console.log(
            JSON.stringify({
              missX: key.X.filter(
                (v) => !w.grid.x.some((g) => Math.abs(g - v) <= 6),
              ),
              missY: key.Y.filter(
                (v) => !w.grid.y.some((g) => Math.abs(g - v) <= 6),
              ),
              gx: w.grid.x,
              gy: w.grid.y,
              near: w.segs.filter(
                (q) =>
                  (q.dir === "h" &&
                    [1548, 1472, 1987].some((v) => Math.abs(q.c - v) < 14)) ||
                  (q.dir === "v" &&
                    [2386, 2649].some((v) => Math.abs(q.c - v) < 14)),
              ),
            }),
          );
        expect(hit(key.X, w.grid.x)).toBeGreaterThanOrEqual(
          Math.ceil(key.X.length * 0.9),
        );
        expect(hit(key.Y, w.grid.y)).toBeGreaterThanOrEqual(
          Math.ceil(key.Y.length * 0.9),
        );
      },
      120_000,
    );
  },
);
