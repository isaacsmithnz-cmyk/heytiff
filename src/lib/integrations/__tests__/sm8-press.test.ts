/**
 * @jest-environment node
 */

/* A press: the proof a PERSON asked for a write to ServiceM8, now. It is
   minted from the session, or from a context the phone's token check made,
   and nothing else; it goes stale; a look-alike isn't one — and only the
   "use server" actions and the phone's routes may mint one, and only the
   actions queue with it, which the import boundary below holds by reading
   the source. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

jest.mock("server-only", () => ({}));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
const staffProfileIdFor = jest.fn();
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: (...a: unknown[]) => staffProfileIdFor(...a) }));
const verifiedCtx = new WeakSet<object>();
jest.mock("@/lib/mobile/auth", () => ({ isVerifiedMobile: (ctx: object) => !!ctx && verifiedCtx.has(ctx) }));

import type { MobileCtx } from "@/lib/mobile/auth";
import { isSm8Press, sm8PressFromMobile, sm8PressFromSession, SM8_PRESS_MAX_AGE_MS, type Sm8Press } from "../sm8-press";

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ orgId: "org-1", user: { sub: "auth0|sam" } });
  staffProfileIdFor.mockReset().mockResolvedValue("staff-sam");
});

describe("a press", () => {
  it("is made from the session: the workspace, the person and their staff card", async () => {
    const press = await sm8PressFromSession();
    expect(press).toMatchObject({ orgId: "org-1", userId: "auth0|sam", staffId: "staff-sam" });
    expect(isSm8Press(press)).toBe(true);
    expect(staffProfileIdFor).toHaveBeenCalledWith("org-1", "auth0|sam");
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
    getSession.mockResolvedValue({ user: { sub: "auth0|sam" } });
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

describe("a press from the phone", () => {
  const ctxOf = (orgId: string, userId: string): MobileCtx => ({ userId, orgId, role: "staff", caps: new Set(), orgIds: [orgId] }) as MobileCtx;

  it("is made from a context the token check made: its workspace, its person, their card", async () => {
    const ctx = ctxOf("org-2", "auth0|pat");
    verifiedCtx.add(ctx);
    staffProfileIdFor.mockResolvedValue("staff-pat");
    const press = await sm8PressFromMobile(ctx);
    expect(press).toMatchObject({ orgId: "org-2", userId: "auth0|pat", staffId: "staff-pat" });
    expect(isSm8Press(press)).toBe(true);
    expect(staffProfileIdFor).toHaveBeenCalledWith("org-2", "auth0|pat");
    expect(Object.isFrozen(press)).toBe(true);
    // the session plays no part
    expect(getSession).not.toHaveBeenCalled();
  });

  it("isn't made from a look-alike: the same fields, unverified, mint nothing", async () => {
    const real = ctxOf("org-2", "auth0|pat");
    verifiedCtx.add(real);
    expect(await sm8PressFromMobile({ ...real })).toBeNull();
    expect(await sm8PressFromMobile(ctxOf("org-2", "auth0|pat"))).toBeNull();
    expect(await sm8PressFromMobile(null as unknown as MobileCtx)).toBeNull();
    expect(staffProfileIdFor).not.toHaveBeenCalled();
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

/** One of the phone's routes (app/api/mobile/…/route.ts). */
const isMobileRoute = (path: string) => relative(SRC, path).startsWith(join("app", "api", "mobile")) && /route\.ts$/.test(path);

/** Every import of the press module in `text` is of its types alone. */
const typeOnly = (text: string) => {
  const imports = [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s+["'](?:@\/lib\/integrations|\.)\/sm8-press["']/g)];
  return imports.length > 0 && imports.every((m) => !!m[1] || m[2]!.split(",").every((n) => !n.trim() || /^type\s/.test(n.trim())));
};

/** The code without its comments: a comment that names a function isn't a
    use of it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("only a person's press queues a write", () => {
  const files = sources(SRC).map((path) => ({ path, text: code(readFileSync(path, "utf8")) }));

  it("only the \"use server\" actions and the phone's routes import the press — and the queue, to check one", () => {
    const importers = files.filter((f) => /from\s+["'](@\/lib\/integrations|\.)\/sm8-press["']/.test(f.text));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      const rel = relative(SRC, f.path);
      if (rel === join("lib", "integrations", "sm8-writes.ts")) {
        // the queue checks a press; it never mints one
        expect(f.text).not.toMatch(/sm8PressFrom(Session|Mobile)/);
        continue;
      }
      // a helper that only names the type holds a press it was handed
      if (typeOnly(f.text)) continue;
      if (isMobileRoute(f.path)) {
        // a phone route mints from its own token check, after it, and never from a session
        expect(f.text).not.toMatch(/sm8PressFromSession/);
        const checked = f.text.indexOf("requireMobile(");
        const minted = f.text.indexOf("sm8PressFromMobile(");
        expect({ file: rel, checked: checked >= 0, before: checked < minted }).toEqual({ file: rel, checked: true, before: true });
        continue;
      }
      expect({ file: rel, action: isServerAction(f.path, f.text) }).toEqual({ file: rel, action: true });
      // and an action mints from its session, never from a phone's context
      expect(f.text).not.toMatch(/sm8PressFromMobile/);
    }
  });

  it("the phone's routes never queue: they hand a press to the actions' helpers", () => {
    for (const f of files.filter((f) => isMobileRoute(f.path))) {
      expect({ file: relative(SRC, f.path), queues: /\b(enqueueSm8Writes|enqueueAttachments|retryFailedSm8Writes)\b/.test(f.text) }).toEqual({
        file: relative(SRC, f.path),
        queues: false,
      });
    }
  });

  it("only the note queue's helpers queue a note — nothing else passes kind \"note\"", () => {
    /* two-way phase 2: a note goes as whoever pressed it, and every rule
       about who may press it again or take it back lives in one file */
    const noteQueue = join("app", "actions", "sm8-note-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']note["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([noteQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === noteQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    // and it checks the press before anything else it exports does
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("only the booking queue's helpers queue a booking — nothing else passes kind \"booking\"", () => {
    /* two-way phase 3 (B-13): every rule about which booking row may go, and
       who may take one back, lives in one file */
    const bookingQueue = join("app", "actions", "sm8-booking-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']booking["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([bookingQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === bookingQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    // each of its four doors checks the press before anything else
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("only the leave queue's helpers queue leave — nothing else passes kind \"leave\"", () => {
    /* leave to ServiceM8: which person, which span, and whether anything of
       it can be on the board to take off, decided in one file */
    const leaveQueue = join("app", "actions", "sm8-leave-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']leave["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([leaveQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === leaveQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    // both doors check the press before anything else
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("only the customer queue's helper queues a customer change — nothing else passes kind \"customer\"", () => {
    const customerQueue = join("app", "actions", "sm8-customer-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']customer["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([customerQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === customerQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("only the quote queue's helper queues an accepted quote — nothing else passes kind \"quote\"", () => {
    const quoteQueue = join("app", "actions", "sm8-quote-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']quote["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([quoteQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === quoteQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("only the job queue's helper queues a new job — nothing else passes kind \"job\"", () => {
    const jobQueue = join("app", "actions", "sm8-job-queue.ts");
    const writers = files.filter(
      (f) =>
        relative(SRC, f.path) !== join("lib", "integrations", "sm8-writes.ts") &&
        /kind:\s*["']job["']/.test(f.text) &&
        /\benqueueSm8Writes\b/.test(f.text)
    );
    expect(writers.map((f) => relative(SRC, f.path))).toEqual([jobQueue]);
    const queue = files.find((f) => relative(SRC, f.path) === jobQueue)!;
    expect(isServerAction(queue.path, queue.text)).toBe(true);
    expect(queue.text.match(/isSm8Press\(press\)/g)?.length).toBeGreaterThanOrEqual(1);
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
