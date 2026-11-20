/** @jest-environment node */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { readMeasured, type AskMeasured } from "../../measured-server";
import type { ReadSpace } from "../../reading";
import { agreement } from "../rooms";
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

/* THE ROOMS, with the model asked for real: PLAN_EVAL_ROOMS=1 as well, and
   ANTHROPIC_API_KEY set. It spends money (two questions a floor), so it
   never runs unasked. `key/mine<n>.json` holds the rooms set by hand, on the
   wall lines, in the drawn page's pixels. Her pictures and her answer are
   written to `out/` in the folder, to be looked at. */
const rooms =
  have && process.env.PLAN_EVAL_ROOMS && process.env.ANTHROPIC_API_KEY;
(rooms ? describe : describe.skip)(
  "a real set's rooms, against its answer key",
  () => {
    const pages = (process.env.PLAN_EVAL_PAGES ?? "9,10,11")
      .split(",")
      .map(Number)
      .filter((n) => existsSync(path.join(DIR, "key", `mine${n}.json`)));
    it.each(pages)(
      "page %i's rooms",
      async (n) => {
        const key = (
          JSON.parse(
            readFileSync(path.join(DIR, "key", `mine${n}.json`), "utf8"),
          ) as {
            name: string;
            kind: ReadSpace["kind"];
            o: [number, number][];
          }[]
        ).map((r): ReadSpace => ({
          name: r.name,
          named: true,
          kind: r.kind,
          outline: r.o.map(([x, y]) => ({ x, y })),
          written: "",
          existing: false,
          openTo: "",
          stair: "",
        }));
        const { data, info } = await sharp(path.join(DIR, "pages", `p${n}.png`))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const words = JSON.parse(
          readFileSync(path.join(DIR, "pages", `p${n}.words.json`), "utf8"),
        ) as { text: string; at: { x: number; y: number } }[];
        const client = new Anthropic();
        mkdirSync(path.join(DIR, "out"), { recursive: true });
        let asked = 0;
        let usd = 0;
        const ask: AskMeasured = async (pictures, text, schema, maxTokens) => {
          asked++;
          pictures.forEach((p, i) =>
            writeFileSync(
              path.join(DIR, "out", `p${n}-ask${asked}-${i}.png`),
              p,
            ),
          );
          const msg = await client.messages
            .stream({
              model: process.env.PLAN_EVAL_MODEL ?? "claude-opus-5-5",
              max_tokens: maxTokens,
              output_config: {
                effort: "high",
                format: { type: "json_schema", schema },
              },
              messages: [
                {
                  role: "user",
                  content: [
                    ...pictures.map((p) => ({
                      type: "image" as const,
                      source: {
                        type: "base64" as const,
                        media_type: "image/png" as const,
                        data: p.toString("base64"),
                      },
                    })),
                    { type: "text" as const, text },
                  ],
                },
              ],
            } as Parameters<typeof client.messages.stream>[0])
            .finalMessage();
          /* Opus 5.5's price, a million tokens: 4 in, 20 out */
          usd +=
            (msg.usage.input_tokens * 4 + msg.usage.output_tokens * 20) / 1e6;
          const block = [...msg.content]
            .reverse()
            .find((b) => b.type === "text");
          const raw = JSON.parse(
            block && block.type === "text" ? block.text : "{}",
          ) as Record<string, unknown>;
          writeFileSync(
            path.join(DIR, "out", `p${n}-answer${asked}.json`),
            JSON.stringify(raw, null, 1),
          );
          return raw;
        };
        const t0 = Date.now();
        /* the drawn page is the raster here: times 1 */
        const read = await readMeasured(
          { rgba: data, width: info.width, height: info.height, words },
          1,
          { floorName: `page ${n}`, mmPerPx: null, ask },
        );
        expect(read).not.toBeNull();
        writeFileSync(
          path.join(DIR, "out", `p${n}-read.json`),
          JSON.stringify(read, null, 1),
        );
        const a = agreement(key, read!.spaces);
        console.log(
          JSON.stringify({
            n,
            secs: Math.round((Date.now() - t0) / 1000),
            usd: Math.round(usd * 100) / 100,
            rounds: read!.rounds,
            key: key.length,
            read: read!.spaces.length,
            both: a.both,
            agree: a.agree,
            onlyKey: a.onlyA,
            onlyRead: a.onlyB,
            problems: read!.problems.map((p) => p.said),
          }),
        );
        expect(a.agree).toBeGreaterThanOrEqual(Math.floor(key.length * 0.8));
      },
      900_000,
    );
  },
);
