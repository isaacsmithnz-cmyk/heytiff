/* The one place a ServiceM8 web-app URL is built, pinned.

   The PATTERN itself cannot be tested — it is documentation
   (developer.servicem8.com/reference/listjobs.md, "Opening Records in
   ServiceM8"), not something the API hands back, so a test can only hold us
   to what was read there. What IS worth pinning is the guard: the card
   passes whatever id it is holding, and a link built out of rubbish sends
   the reader to a 404 with our own mistake in the path. */

import { sm8JobUrl } from "../sm8-links";

const UUID = "0f11827a-29ad-4575-a5a4-21cfb0c5c75b";

describe("sm8JobUrl", () => {
  it("builds the documented job door", () => {
    expect(sm8JobUrl(UUID)).toBe(`https://go.servicem8.com/OpenJob/${UUID}`);
  });

  it("takes an uppercase uuid as ServiceM8 spells it", () => {
    expect(sm8JobUrl(UUID.toUpperCase())).toBe(
      `https://go.servicem8.com/OpenJob/${UUID.toUpperCase()}`
    );
  });

  it("trims — an id read out of a row can carry whitespace", () => {
    expect(sm8JobUrl(`  ${UUID}\n`)).toBe(`https://go.servicem8.com/OpenJob/${UUID}`);
  });

  it("REFUSES anything that is not an id, so the caller renders no door", () => {
    expect(sm8JobUrl(null)).toBeNull();
    expect(sm8JobUrl(undefined)).toBeNull();
    expect(sm8JobUrl("")).toBeNull();
    expect(sm8JobUrl("   ")).toBeNull();
    /* A test fixture's id, a job NUMBER, a truncated uuid — none of these
       open anything over there. */
    expect(sm8JobUrl("j-1")).toBeNull();
    expect(sm8JobUrl("2380")).toBeNull();
    expect(sm8JobUrl(UUID.slice(0, 20))).toBeNull();
  });

  it("cannot be talked into leaving the job path", () => {
    expect(sm8JobUrl("../OpenClient/x")).toBeNull();
    expect(sm8JobUrl(`${UUID}/../../evil`)).toBeNull();
    expect(sm8JobUrl("https://elsewhere.example/x")).toBeNull();
  });
});
