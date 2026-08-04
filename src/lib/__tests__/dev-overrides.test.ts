import { EFFORTS, effortChoice, isEffort, transportChoice } from "../dev-overrides";

/* The A/B switches. They are dev plumbing, but between them they decide
   which vendor endpoint a note goes to and how much a routing call costs —
   and a sticky override nobody remembers setting is exactly the kind of
   thing that gets mistaken for a broken feature later. */

const at = (search: string) => window.history.replaceState({}, "", `/dashboard${search}`);

beforeEach(() => {
  sessionStorage.clear();
  at("");
});

describe("transport override", () => {
  // NEXT_PUBLIC_VOICE_REALTIME is unset under jest, so the flag reads false
  it("follows the build flag when nothing is asked for", () => {
    expect(transportChoice()).toBe(false);
  });

  it("?voice=live beats a flag that is off", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
  });

  it("sticks for the rest of the session once the query string is gone", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
    at(""); // navigated on within the app
    expect(transportChoice()).toBe(true);
  });

  it("clears on any other ?voice= value, so it can't get stuck", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
    at("?voice=off");
    expect(transportChoice()).toBe(false);
  });

  it("leaves an unrelated query string alone", () => {
    at("?voice=live");
    transportChoice();
    at("?tab=notes");
    expect(transportChoice()).toBe(true);
  });
});

describe("effort override", () => {
  it("is null by default, so the shipped setting decides", () => {
    expect(effortChoice()).toBeNull();
  });

  it.each(EFFORTS)("accepts ?effort=%s", (level) => {
    at(`?effort=${level}`);
    expect(effortChoice()).toBe(level);
  });

  it("sticks for the rest of the session", () => {
    at("?effort=low");
    expect(effortChoice()).toBe("low");
    at("");
    expect(effortChoice()).toBe("low");
  });

  it("clears on a level the vendor doesn't accept", () => {
    at("?effort=max");
    expect(effortChoice()).toBe("max");
    // "extreme" isn't one of the five — silently back to the default
    at("?effort=extreme");
    expect(effortChoice()).toBeNull();
  });

  /* The two switches are independent: measuring effort shouldn't silently
     move the transport, or the second comparison is confounded. */
  it("doesn't disturb the transport", () => {
    at("?voice=live");
    transportChoice();
    at("?effort=low");
    expect(effortChoice()).toBe("low");
    expect(transportChoice()).toBe(true);
  });

  it("carries both at once", () => {
    at("?voice=batch&effort=xhigh");
    expect(transportChoice()).toBe(false);
    expect(effortChoice()).toBe("xhigh");
  });
});

describe("effort guard", () => {
  // the server re-checks whatever the browser sends — an effort level is a
  // cost lever, and a server action is reachable directly
  it.each(EFFORTS)("accepts %s", (level) => {
    expect(isEffort(level)).toBe(true);
  });

  it.each([["extreme"], ["HIGH"], [""], [null], [undefined], [3], [{}]])(
    "rejects %p",
    (value) => {
      expect(isEffort(value)).toBe(false);
    }
  );

  it("is exactly the five the API documents", () => {
    expect([...EFFORTS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});
