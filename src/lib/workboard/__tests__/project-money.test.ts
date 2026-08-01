/* The money model's law, held still: two axes that never mix, and a target
   that only APPROVED variations may move. The canonical worked example is
   Isaac's own (2026-08-01): $50k job, $10k claimed, $4k variation approved →
   "Claimed $10,000 of $54,000 — $44,000 to go", with paid-ness living on the
   claim rows and never in that sentence. */

import {
  claimedLine,
  deriveProjectMoney,
  fmtAud,
  parseAudToCents,
  type ClaimFact,
  type VariationFact,
} from "../project-money";

const claim = (amountCents: number, status: ClaimFact["status"] = "awaiting"): ClaimFact => ({
  amountCents,
  status,
});
const variation = (
  amountCents: number,
  status: VariationFact["status"] = "pending"
): VariationFact => ({ amountCents, status });

describe("the canonical example", () => {
  it("claims count toward the line whether or not they are paid", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [],
      claims: [claim(1_000_000, "paid")],
    });
    expect(m.claimedCents).toBe(1_000_000);
    expect(m.remainingCents).toBe(4_000_000);
    expect(claimedLine(m)).toBe("Claimed $10,000 of $50,000 — $40,000 to go");
  });

  it("an approved variation moves the TARGET, never the claimed", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [variation(400_000, "approved")],
      claims: [claim(1_000_000)],
    });
    expect(m.revisedTotalCents).toBe(5_400_000);
    expect(m.claimedCents).toBe(1_000_000);
    expect(claimedLine(m)).toBe("Claimed $10,000 of $54,000 — $44,000 to go");
  });

  it("paid-ness never appears in the claimed line — only in the axis-2 rollups", () => {
    const claims = [claim(1_000_000, "paid"), claim(500_000, "awaiting")];
    const m = deriveProjectMoney({ budgetCents: 5_000_000, variations: [], claims });
    expect(m.claimedCents).toBe(1_500_000);
    expect(m.paidCents).toBe(1_000_000);
    expect(m.awaitingCents).toBe(500_000);
    // Same line whichever way the paid flags sit.
    const flipped = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [],
      claims: claims.map((c) => ({ ...c, status: "awaiting" as const })),
    });
    expect(claimedLine(m)).toBe(claimedLine(flipped));
  });
});

describe("variations and the target", () => {
  it("pending and declined variations count for nothing in the total", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [variation(400_000, "pending"), variation(900_000, "declined")],
      claims: [],
    });
    expect(m.revisedTotalCents).toBe(5_000_000);
    expect(m.pendingVariationCents).toBe(400_000);
  });

  it("a credit variation subtracts — approved sums are signed", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [variation(-250_000, "approved")],
      claims: [],
    });
    expect(m.revisedTotalCents).toBe(4_750_000);
  });

  it("without a budget there is no total and no remaining, but claims still sum", () => {
    const m = deriveProjectMoney({
      budgetCents: null,
      variations: [variation(400_000, "approved")],
      claims: [claim(1_000_000)],
    });
    expect(m.revisedTotalCents).toBeNull();
    expect(m.remainingCents).toBeNull();
    expect(m.claimedPercent).toBeNull();
    expect(m.claimedCents).toBe(1_000_000);
    expect(claimedLine(m)).toBeNull();
  });
});

describe("over-claiming", () => {
  it("claiming past the target goes negative and the line says so", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [],
      claims: [claim(5_500_000)],
    });
    expect(m.remainingCents).toBe(-500_000);
    expect(claimedLine(m)).toBe("Claimed $55,000 of $50,000 — $5,000 over the total");
  });
});

describe("percent", () => {
  it("is claimed over the REVISED total", () => {
    const m = deriveProjectMoney({
      budgetCents: 5_000_000,
      variations: [variation(5_000_000, "approved")],
      claims: [claim(5_000_000)],
    });
    expect(m.claimedPercent).toBe(50);
  });
});

describe("fmtAud", () => {
  it("whole dollars stay whole, real cents show", () => {
    expect(fmtAud(5_400_000)).toBe("$54,000");
    expect(fmtAud(123_450)).toBe("$1,234.50");
    expect(fmtAud(5)).toBe("$0.05");
    expect(fmtAud(0)).toBe("$0");
    expect(fmtAud(-400_000)).toBe("-$4,000");
  });
});

describe("parseAudToCents", () => {
  it("takes what people type", () => {
    expect(parseAudToCents("50000")).toBe(5_000_000);
    expect(parseAudToCents("$50,000")).toBe(5_000_000);
    expect(parseAudToCents("1234.50")).toBe(123_450);
    expect(parseAudToCents("-4000")).toBe(-400_000);
    expect(parseAudToCents(" $1,234.50 ")).toBe(123_450);
  });

  it("refuses what isn't money", () => {
    expect(parseAudToCents("")).toBeNull();
    expect(parseAudToCents("fifty")).toBeNull();
    expect(parseAudToCents("1.234")).toBeNull();
    expect(parseAudToCents("12,34")).toBe(1_234_00); // commas are cosmetic, not positional
    expect(parseAudToCents("200000000")).toBeNull(); // past the $100M sanity cap
  });
});
