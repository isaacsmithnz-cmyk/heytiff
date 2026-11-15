import { stockWordOf } from "../job-materials-face";
import type { EquipmentRow } from "@/lib/stock/stock";

/* On site's Materials: each unit and control carries its word from Stock,
   in place of an Equipment card (Isaac, 14 November 2026, mock F) */
const row = (over: Partial<EquipmentRow> = {}): EquipmentRow => ({ key: "k", title: "Outdoor, 15.5 kW", detail: "PUMY-SP140VKMD2-A", qty: 1, group: "unit", when: "Install, not booked yet", word: { tone: "look", word: "To order" }, ...over });

it("gives a unit's row Stock's word by its model", () => {
  expect(stockWordOf({ name: "Outdoor unit", sub: "PUMY-SP140VKMD2-A" }, [row()])).toEqual({ tone: "look", word: "To order" });
  expect(stockWordOf({ name: "Outdoor unit", sub: "pumy-sp140vkmd2-a " }, [row({ word: { tone: "good", word: "In stock" } })])).toEqual({ tone: "good", word: "In stock" });
});

it("gives nothing to a row Stock doesn't hold, nor to duct", () => {
  expect(stockWordOf({ name: "Flex duct", sub: "250 mm" }, [row()])).toBeNull();
  expect(stockWordOf({ name: "Duct", sub: "PUMY-SP140VKMD2-A" }, [row({ group: "duct" })])).toBeNull();
  expect(stockWordOf({ name: "Outdoor unit", sub: "PUMY-SP140VKMD2-A" }, null)).toBeNull();
});
