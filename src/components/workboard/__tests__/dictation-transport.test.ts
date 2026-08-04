import { transportChoice } from "../dictation";

/* The A/B switch. It is dev plumbing, but it decides which vendor endpoint
   a note goes to, and a sticky override nobody remembers setting is exactly
   the kind of thing that gets mistaken for a broken feature later. */

const KEY = "heytiff.voice.transport";

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

  it("?voice=batch beats a flag that is on", () => {
    at("?voice=batch");
    expect(transportChoice()).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBe("batch");
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
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("leaves an unrelated query string alone", () => {
    at("?voice=live");
    transportChoice();
    at("?tab=notes");
    expect(transportChoice()).toBe(true);
  });
});
