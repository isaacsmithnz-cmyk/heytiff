/* THIRTY REAL QUOTES, READ THE SAME WAY EVERY TIME. Recent finished jobs'
   descriptions, as written, with installs, services, relocations and a
   warranty letter among them. Each reading was checked by hand against its
   quote (2026-10-03); a change to the reader that reads any of them
   differently fails here, and the expected file is updated only once the
   new reading has been checked as right.

   Services, relocations and maintenance read as nothing: a certificate is
   for an installation. */

import fs from "node:fs";
import path from "node:path";
import { readQuote } from "../quote";

const dir = path.join(__dirname, "fixtures");
const jobs = JSON.parse(fs.readFileSync(path.join(dir, "batch-2026-10.json"), "utf8")) as { n: string; d: string }[];
const expected = fs.readFileSync(path.join(dir, "batch-2026-10.expected.txt"), "utf8").split(/\n(?=\d)/);

function summary(n: string, d: string): string {
  const q = readQuote(d);
  const sys = q.systems.map(
    (s) =>
      `OUT[${s.outdoor.qty > 1 ? s.outdoor.qty + "x " : ""}${s.outdoor.capacityKw ?? "?"}kW ${s.outdoor.model || "-"} @${s.outdoor.location || "-"}] -> ` +
      s.indoors.map((r) => `${r.qty > 1 ? r.qty + "x " : ""}${r.capacityKw ?? "?"} ${r.model || "-"} @${r.location || "-"}`).join(" | ")
  );
  const fans = q.fans.map((f) => `FAN ${f.qty}x ${f.model || "-"} @${f.location || "-"}`);
  return [n, ...sys, ...fans].join("\n   ");
}

describe("thirty real quotes", () => {
  it.each(jobs.map((j, i) => [j.n, j.d, expected[i]] as const))("job %s reads as checked", (n, d, want) => {
    expect(summary(n, d)).toBe(want.trimEnd());
  });
});
