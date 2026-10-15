/**
 * @jest-environment node
 */
/* The makers a kit's unit can be read off: every installed data pack, by
   the key a lookup reads it by and in words. The kit form offered
   Mitsubishi Electric or nothing (2026-10-15), Diamond Air's brand for
   every business. */
import { readdirSync } from "fs";
import path from "path";

jest.mock("server-only", () => ({}));
jest.mock("../book-view-server", () => ({ bookProducts: jest.fn(async () => []) }));

import { packMakers } from "../lookups-server";

it("lists every installed pack's maker, once, in words", async () => {
  const installed = [...new Set(readdirSync(path.join(process.cwd(), "data", "packs")).filter((n) => n.lastIndexOf("@") > 0).map((n) => n.slice(0, n.lastIndexOf("@"))))];
  const makers = await packMakers();
  expect(makers.map((m) => m.key).sort()).toEqual(installed.sort());
  expect(makers.length).toBeGreaterThan(1);
  expect(makers).toEqual(expect.arrayContaining([{ key: "mitsubishi-electric", name: "Mitsubishi Electric" }, { key: "daikin", name: "Daikin" }]));
});
