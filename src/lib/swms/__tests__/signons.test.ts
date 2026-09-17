import { effectiveSignons, type ChainPerson, type ChainVersion } from "../signons";

/* A correction carries sign-ons; a change to how the work is done doesn't. */

const v = (id: string, version: number, material = true): ChainVersion => ({ id, version, material });
const staff = (id: string, versionId: string, staffProfileId: string): ChainPerson => ({ id, versionId, staffProfileId, outsideName: null });
const helper = (id: string, versionId: string, outsideName: string): ChainPerson => ({ id, versionId, staffProfileId: null, outsideName });

const signed = (...ids: string[]) => (id: string) => (ids.includes(id) ? `sig:${id}` : null);

describe("effectiveSignons", () => {
  it("keeps a person's own sign-on, on the version they gave it", () => {
    const got = effectiveSignons([v("v1", 1)], [staff("a1", "v1", "dane")], signed("a1"));
    expect(got.get("a1")).toEqual({ signon: "sig:a1", version: 1 });
  });

  it("carries a sign-on onto a correction, for the same person, saying which version it was given on", () => {
    const got = effectiveSignons(
      [v("v1", 1), v("v2", 2, false)],
      [staff("a1", "v1", "dane"), staff("a2", "v2", "dane"), helper("k1", "v1", "Kai Lindqvist"), helper("k2", "v2", " kai lindqvist ")],
      signed("a1", "k1")
    );
    expect(got.get("a2")).toEqual({ signon: "sig:a1", version: 1 });
    expect(got.get("k2")).toEqual({ signon: "sig:k1", version: 1 });
  });

  it("asks again after a change to how the work is done", () => {
    const got = effectiveSignons([v("v1", 1), v("v2", 2, true)], [staff("a1", "v1", "dane"), staff("a2", "v2", "dane")], signed("a1"));
    expect(got.get("a2")).toBeNull();
  });

  it("carries through two corrections in a row, but never past a material version", () => {
    const people = [staff("a1", "v1", "dane"), staff("a2", "v2", "dane"), staff("a3", "v3", "dane"), staff("a4", "v4", "dane")];
    const chain = [v("v1", 1), v("v2", 2, false), v("v3", 3, true), v("v4", 4, false)];
    const got = effectiveSignons(chain, people, signed("a1"));
    expect(got.get("a2")).toEqual({ signon: "sig:a1", version: 1 });
    expect(got.get("a3")).toBeNull();
    expect(got.get("a4")).toBeNull();
  });

  it("asks someone new on a correction", () => {
    const got = effectiveSignons([v("v1", 1), v("v2", 2, false)], [staff("a1", "v1", "dane"), staff("s2", "v2", "sam")], signed("a1"));
    expect(got.get("s2")).toBeNull();
  });

  it("prefers a person's own newer sign-on to a carried one", () => {
    const got = effectiveSignons([v("v1", 1), v("v2", 2, false)], [staff("a1", "v1", "dane"), staff("a2", "v2", "dane")], signed("a1", "a2"));
    expect(got.get("a2")).toEqual({ signon: "sig:a2", version: 2 });
  });
});
