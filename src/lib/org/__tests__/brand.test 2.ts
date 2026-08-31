import { brandContact, brandInitials, hasBrand, NO_BRAND, type OrgBrand } from "../brand";

/* The letterhead's rules — see lib/org/brand.ts.

   Two of these guard the same thing from opposite sides: a surface must show
   the installer's name when there IS one, and must NOT displace its own
   wording with an empty frame when there is not. Every caller falls back
   ("HeyTiff", "HeyTiff Design Studio", no band at all), and the fallback is
   chosen by hasBrand. */

const FULL: OrgBrand = {
  name: "Smith Air Conditioning",
  logoUrl: "https://signed.example/logo.png",
  abn: "51824753556",
  phone: "(03) 9000 0000",
  email: "office@smithair.com.au",
  website: "smithair.com.au",
  color: null,
};

describe("hasBrand", () => {
  it("is true for a name alone, and for a logo alone", () => {
    expect(hasBrand({ ...NO_BRAND, name: "Smith Air" })).toBe(true);
    expect(hasBrand({ ...NO_BRAND, logoUrl: "https://x/y.png" })).toBe(true);
  });

  /* The case that matters: an org that has filled in a phone number and
     nothing else must not put a nameless, logo-less band at the top of a
     customer's handover sheet. */
  it("is false when there is neither, however much else is set", () => {
    expect(hasBrand(NO_BRAND)).toBe(false);
    expect(hasBrand({ ...FULL, name: "", logoUrl: null })).toBe(false);
    expect(hasBrand({ ...NO_BRAND, name: "   " })).toBe(false);
  });
});

describe("brandContact", () => {
  it("leads with the ABN, in the grouping it is checked against", () => {
    expect(brandContact(FULL)[0]).toBe("ABN 51 824 753 556");
  });

  it("runs ABN, phone, email, website — the order someone reaches for them", () => {
    expect(brandContact(FULL)).toEqual([
      "ABN 51 824 753 556",
      "(03) 9000 0000",
      "office@smithair.com.au",
      "smithair.com.au",
    ]);
  });

  it("keeps a malformed ABN as typed rather than dropping it", () => {
    // formatAbn only groups 11 digits; anything else is the business's own text
    expect(brandContact({ ...NO_BRAND, abn: "pending" })).toEqual(["ABN pending"]);
  });

  it("returns nothing at all when the business has given nothing", () => {
    expect(brandContact(NO_BRAND)).toEqual([]);
    expect(brandContact({ ...NO_BRAND, phone: "  ", email: "" })).toEqual([]);
  });
});

describe("brandInitials", () => {
  it("takes two letters, and only two", () => {
    expect(brandInitials("Smith Air Conditioning")).toBe("SA");
    expect(brandInitials("Diamond")).toBe("D");
  });

  /* Empty, not a dash: the caller renders NOTHING rather than a chip with a
     placeholder in it — a mark that says "—" is worse than no mark. */
  it("is empty for a nameless business", () => {
    expect(brandInitials("")).toBe("");
    expect(brandInitials("   ")).toBe("");
  });
});
