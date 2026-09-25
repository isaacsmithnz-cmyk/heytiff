/**
 * @jest-environment node
 */

/* DEPLOY.md is what somebody follows to make the overnight run work, and it
   used to say Vercel sets CRON_SECRET by itself. Vercel's own docs say you
   create it ("adding an environment variable called CRON_SECRET to your
   Vercel project"), and until somebody does, every scheduled call is refused
   and the overnight top-up does nothing. These hold the corrected wording. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const deploy = readFileSync(join(__dirname, "..", "..", "..", "DEPLOY.md"), "utf8");

describe("DEPLOY.md on CRON_SECRET", () => {
  it("says you create it yourself, and that Vercel then sends it", () => {
    const row = deploy.split("\n").find((l) => l.startsWith("| `CRON_SECRET` |"))!;
    expect(row).toMatch(/You create it/);
    expect(row).toMatch(/Authorization: Bearer <CRON_SECRET>/);
    expect(row).toMatch(/Unset ⇒ every cron request is refused/);
  });

  it("nowhere says Vercel sets it, or manages it, itself", () => {
    expect(deploy).not.toMatch(/Vercel (sets|manages)[^.\n]*CRON_SECRET|CRON_SECRET[^.\n]*(sets|manages) (it|this) itself|Vercel sets and sends/i);
    expect(deploy).not.toMatch(/Nothing to configure — Vercel/);
  });

  it("makes the proven overnight run a phase-0 exit check", () => {
    expect(deploy).toMatch(/Phase 0 isn't finished until the overnight run is proven/);
    expect(deploy).toMatch(/Last overnight sync/);
    expect(deploy).toMatch(/a\s+401 there means `CRON_SECRET` is missing or different/);
  });

  it("names the migration, and the rolled-back script to run first", () => {
    expect(deploy).toContain("docs/migrations/sm8_calls_echo_freshness.sql");
    expect(deploy).toContain("docs/migrations/sm8_calls_echo_freshness.test.sql");
  });
});
