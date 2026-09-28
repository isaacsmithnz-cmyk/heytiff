/**
 * @jest-environment node
 */

/* PRODUCTION IS UNCHANGED until SM8_WEBHOOKS=1 on a Production deployment
   (two-way phase 4). This suite holds that, and each PR of the phase adds
   its paths to it: with the env unset, the route answers 404 with no
   database call, the callback and a disconnect send nothing to
   /webhook_subscriptions, the cron and freshen neither ensure nor drain,
   and the meter's `hook` lane takes no turn.

   PR A: the switch itself, and no caller of the `hook` lane yet. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sm8WebhooksState } from "../sm8-hooks-switch";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

function set(vercel: string | undefined, hooks: string | undefined) {
  if (vercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercel;
  if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
  else process.env.SM8_WEBHOOKS = hooks;
}

describe("the switch", () => {
  it("is off anywhere but Production, whatever SM8_WEBHOOKS says", () => {
    for (const vercel of [undefined, "preview", "development", "", "Production"]) {
      for (const hooks of [undefined, "", "0", "1", "gone", "true"]) {
        set(vercel, hooks);
        expect([vercel, hooks, sm8WebhooksState()]).toEqual([vercel, hooks, "off"]);
      }
    }
  });

  it("is off on Production unless it says exactly 1 or gone", () => {
    for (const hooks of [undefined, "", "0", "true", "on", " 1", "1 ", "GONE", "yes"]) {
      set("production", hooks);
      expect([hooks, sm8WebhooksState()]).toEqual([hooks, "off"]);
    }
  });

  it("is on with 1, and gone with gone, on Production", () => {
    set("production", "1");
    expect(sm8WebhooksState()).toBe("on");
    set("production", "gone");
    expect(sm8WebhooksState()).toBe("gone");
  });
});

/* Every file under src/ that takes a turn on the `hook` lane. None in PR A;
   the drain (PR D) adds itself here with its own case above, holding it
   behind the switch. */
const HOOK_LANE_CALLERS: string[] = [];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Whether a source takes a turn on the `hook` lane: the lane passed to
    sm8CallOf or takeSm8Call (its arguments may hold a call of their own),
    or "hook" given to anything named `lane` or typed Sm8Lane. */
function takesHookLane(text: string): boolean {
  const HOOK = `["'\`]hook["'\`]`;
  return [
    new RegExp(`(?:sm8CallOf|takeSm8Call)\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*?${HOOK}`),
    new RegExp(`\\blane\\??\\s*(?::[^=;,)]*)?[:=]\\s*${HOOK}`),
    new RegExp(`:\\s*Sm8Lane\\s*=\\s*${HOOK}`),
    new RegExp(`${HOOK}\\s+(?:as|satisfies)\\s+Sm8Lane\\b`),
  ].some((re) => re.test(text));
}

describe("the meter's hook lane", () => {
  it("is spotted however a caller spells it", () => {
    for (const text of [
      `sm8CallOf(access, "hook")`,
      `sm8CallOf(f(), "hook")`,
      `sm8CallOf(await accessOf(g(org)), 'hook')`,
      `takeSm8Call(meter, "hook", 2)`,
      `const lane: Sm8Lane = "hook";`,
      `let lane = "hook";`,
      `{ accessToken, meter, lane: "hook" }`,
      `const l: Sm8Lane = "hook";`,
      `const l = "hook" as Sm8Lane;`,
    ]) {
      expect([text, takesHookLane(text)]).toEqual([text, true]);
    }
    for (const text of [
      `sm8CallOf(access, "read")`,
      `sm8CallOf(f(), "sync")`,
      `takeSm8Call(meter, "write")`,
      `const lane: Sm8Lane = "read";`,
      `const hook = "hook";`,
      `hook: HOOK_METER_WAIT_MS`,
    ]) {
      expect([text, takesHookLane(text)]).toEqual([text, false]);
    }
  });

  it("is taken by no file but those listed, each held behind the switch", () => {
    const SRC = join(__dirname, "..", "..", "..");
    const callers = sources(SRC)
      .filter((f) => takesHookLane(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(callers).toEqual(HOOK_LANE_CALLERS);
  });
});
