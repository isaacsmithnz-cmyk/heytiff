/**
 * @jest-environment node
 */

/* A press: the proof a PERSON asked for a write to ServiceM8, now. It is
   minted from the session and nothing else, it goes stale, a look-alike
   isn't one — and only the "use server" actions may mint one or queue with
   it, which the import boundary below holds by reading the source. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

jest.mock("server-only", () => ({}));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
const staffProfileIdFor = jest.fn();
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: (...a: unknown[]) => staffProfileIdFor(...a) }));

import { isSm8Press, sm8PressFromSession, SM8_PRESS_MAX_AGE_MS, type Sm8Press } from "../sm8-press";

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ orgId: "org-1", user: { sub: "auth0|isaac" } });
  staffProfileIdFor.mockReset().mockResolvedValue("staff-isaac");
});

describe("a press", () => {
  it("is made from the session: the workspace, the person and their staff card", async () => {
    const press = await sm8PressFromSession();
    expect(press).toMatchObject({ orgId: "org-1", userId: "auth0|isaac", staffId: "staff-isaac" });
    expect(isSm8Press(press)).toBe(true);
    expect(staffProfileIdFor).toHaveBeenCalledWith("org-1", "auth0|isaac");
    // and can't be edited into another workspace's
    expect(Object.isFrozen(press)).toBe(true);
  });

  it("is made for a person with no staff card too", async () => {
    staffProfileIdFor.mockResolvedValue(null);
    const press = await sm8PressFromSession();
    expect(press).toMatchObject({ staffId: null });
    expect(isSm8Press(press)).toBe(true);
  });

  it("isn't made without a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await sm8PressFromSession()).toBeNull();
    getSession.mockResolvedValue({ user: { sub: "auth0|isaac" } });
    expect(await sm8PressFromSession()).toBeNull();
  });

  it("can't be forged: the same fields, or a cast, aren't a press", async () => {
    const press = (await sm8PressFromSession())!;
    expect(isSm8Press({ ...press })).toBe(false);
    expect(isSm8Press({ orgId: "org-1", userId: "u", staffId: null, at: Date.now() } as unknown as Sm8Press)).toBe(false);
    expect(isSm8Press(null)).toBe(false);
    expect(isSm8Press("org-1")).toBe(false);
  });

  it("goes stale: one kept for later is no press", async () => {
    const press = (await sm8PressFromSession())!;
    expect(isSm8Press(press, press.at + SM8_PRESS_MAX_AGE_MS - 1)).toBe(true);
    expect(isSm8Press(press, press.at + SM8_PRESS_MAX_AGE_MS)).toBe(false);
    expect(isSm8Press(press, press.at - 1)).toBe(false);
  });
});

/* ── the import boundary ── */

const SRC = join(process.cwd(), "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const isServerAction = (path: string, text: string) =>
  relative(SRC, path).startsWith(join("app", "actions")) && /^\s*["']use server["'];?/.test(text);

/** The code without its comments: a comment that names a function isn't a
    use of it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("only a person's press queues a write", () => {
  const files = sources(SRC).map((path) => ({ path, text: code(readFileSync(path, "utf8")) }));

  it("only the \"use server\" actions import the press — and the queue, to check one", () => {
    const importers = files.filter((f) => /from\s+["'](@\/lib\/integrations|\.)\/sm8-press["']/.test(f.text));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      const rel = relative(SRC, f.path);
      if (rel === join("lib", "integrations", "sm8-writes.ts")) {
        // the queue checks a press; it never mints one
        expect(f.text).not.toMatch(/sm8PressFromSession/);
        continue;
      }
      expect({ file: rel, action: isServerAction(f.path, f.text) }).toEqual({ file: rel, action: true });
    }
  });

  it("only the \"use server\" actions queue", () => {
    const queuers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /\b(enqueueSm8Writes|enqueueAttachments|retryFailedSm8Writes)\b/.test(f.text)
    );
    expect(queuers.length).toBeGreaterThan(0);
    for (const f of queuers) {
      const rel = relative(SRC, f.path);
      expect({ file: rel, action: isServerAction(f.path, f.text) }).toEqual({ file: rel, action: true });
    }
  });
});
