import { transportChoice } from "../dictation";

/* The transport switch, after it bit.

   This file used to contain a passing test called "sticks for the rest of
   the session once the query string is gone", which is a fair description
   of the bug: `?voice=live` was stashed in sessionStorage, Isaac measured
   with it once, came back to a plain URL later, and every recording went to
   a transport nobody had asked for — reported, reasonably, as the feature
   being broken.

   The test was green the whole time, because it pinned the behaviour rather
   than asking whether the behaviour was wanted. Half of what follows is the
   same fact from different angles, and that is deliberate: this is the one
   property that matters. */

const at = (search: string) => window.history.replaceState({}, "", `/dashboard${search}`);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  at("");
});

describe("transport override", () => {
  // NEXT_PUBLIC_VOICE_REALTIME is unset under jest, so the flag reads false
  it("follows the build flag when the URL asks for nothing", () => {
    expect(transportChoice()).toBe(false);
  });

  it("?voice=live beats a flag that is off", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
  });

  it("?voice=batch is explicit too", () => {
    at("?voice=batch");
    expect(transportChoice()).toBe(false);
  });

  it("ignores a value that isn't one of the two", () => {
    at("?voice=turbo");
    expect(transportChoice()).toBe(false);
  });
});

describe("it cannot outlive the URL that set it", () => {
  it("is gone the moment the query string is", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
    at(""); // navigated on, or came back to a plain URL an hour later
    expect(transportChoice()).toBe(false);
  });

  it("writes nothing a later page load could read back", () => {
    at("?voice=live");
    transportChoice();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("is decided per call — an unrelated query string is not an override", () => {
    at("?voice=live");
    expect(transportChoice()).toBe(true);
    at("?tab=notes");
    expect(transportChoice()).toBe(false);
  });
});
