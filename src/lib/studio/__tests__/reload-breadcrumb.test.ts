/* The breadcrumb exists to answer one question after the fact: when the studio
   went back to Home mid-design, what kind of ending was it? These pin the
   verdicts, because the day they matter is the day nobody can reproduce it. */

import {
  classify,
  describe as describeVerdict,
  UNKNOWN_BUILD,
  type Crumb,
} from "../reload-breadcrumb";

const crumb = (p: Partial<Crumb> = {}): Crumb => ({
  at: "2026-08-25T02:00:00.000Z",
  design: "dsn_abc",
  build: "1a2b3c",
  sinceGesture: 60_000,
  saidGoodbye: true,
  ...p,
});

describe("classify", () => {
  it("has nothing to say on a first visit", () => {
    expect(classify({ navType: "navigate", prev: null, build: "1a2b3c" })).toBe("first-run");
  });

  /* THE ONE WE ARE HUNTING: a deploy replaced the build under an open tab.
     14 production deploys landed in 16 hours the day this was written. */
  it("names a deploy when the build fingerprint moved", () => {
    expect(
      classify({ navType: "reload", prev: crumb({ build: "old999" }), build: "1a2b3c" })
    ).toBe("reload-after-deploy");
  });

  /* a person pressing ⌘R is not a bug, and must not read as one */
  it("blames the person when the load followed a gesture", () => {
    expect(
      classify({ navType: "reload", prev: crumb({ sinceGesture: 400 }), build: "1a2b3c" })
    ).toBe("reload-by-hand");
  });

  /* the residue: same build, nobody touching it. This is the verdict that
     would point at the capability check or the auth gate rather than a deploy */
  it("says so plainly when neither a deploy nor the person explains it", () => {
    expect(
      classify({ navType: "reload", prev: crumb({ sinceGesture: 90_000 }), build: "1a2b3c" })
    ).toBe("reload-unexplained");
  });

  it("treats a load with no design open as nothing lost", () => {
    expect(
      classify({ navType: "reload", prev: crumb({ design: null, build: "old" }), build: "new" })
    ).toBe("opened");
  });

  /* a client-side arrival is the same tab, still alive — it loses nothing, so
     it must never be counted as a reload however the build compares */
  it("does not call an in-app arrival a reload", () => {
    for (const navType of ["prerender", "unknown", "back_forward"]) {
      expect(classify({ navType, prev: crumb({ build: "old" }), build: "new" })).toBe("opened");
    }
  });

  /* a deploy landing is worth knowing even if they also touched something —
     the build moving is the harder fact, so it wins */
  it("prefers the deploy explanation over a recent gesture", () => {
    expect(
      classify({
        navType: "reload",
        prev: crumb({ build: "old999", sinceGesture: 200 }),
        build: "1a2b3c",
      })
    ).toBe("reload-after-deploy");
  });

  /* THE FALSE POSITIVE THAT NEARLY SHIPPED. The build id first came from
     hashing the page's <script src> set, which grows as chunks lazy-load — so
     two loads of the SAME build disagreed and every reload read as a deploy.
     It now comes from the server, and an unknown identity accuses nobody. */
  it("never blames a deploy when either build is unknown", () => {
    expect(
      classify({ navType: "reload", prev: crumb({ build: UNKNOWN_BUILD }), build: "dpl_new" })
    ).not.toBe("reload-after-deploy");
    expect(
      classify({ navType: "reload", prev: crumb({ build: "dpl_old" }), build: UNKNOWN_BUILD })
    ).not.toBe("reload-after-deploy");
    expect(
      classify({
        navType: "reload",
        prev: crumb({ build: UNKNOWN_BUILD }),
        build: UNKNOWN_BUILD,
      })
    ).toBe("reload-unexplained");
  });

  /* an unknown gesture time must not masquerade as "they did it" */
  it("does not blame the person when the gesture time is unknown", () => {
    expect(
      classify({ navType: "navigate", prev: crumb({ sinceGesture: null }), build: "1a2b3c" })
    ).toBe("reload-unexplained");
  });
});

describe("describe", () => {
  it("says something a person can read, naming both builds on a deploy", () => {
    const line = describeVerdict({
      at: "2026-08-25T02:00:00.000Z",
      verdict: "reload-after-deploy",
      navType: "reload",
      lost: "dsn_abc",
      gapMs: 1200,
      build: "new111",
      prevBuild: "old999",
    });
    expect(line).toContain("deploy");
    expect(line).toContain("old999");
    expect(line).toContain("new111");
  });
});
