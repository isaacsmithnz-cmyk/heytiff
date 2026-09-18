/* WHAT THE OWNER APPROVES. The template page and the wizard's approval screen
   say "every SWMS is written from these steps and controls", so every branch
   the crew can choose on site has to be on the page — it used to be built
   from the default answers alone, which meant the owner never saw the
   harness, the scaffold, the EWP, on-tool extraction, the Queensland clauses
   or the flammable-refrigerant controls. */

import { render, screen } from "@testing-library/react";
import { TemplateSteps } from "../template-steps";

const shown = (text: RegExp) => screen.getByText(text);

it("shows every choice the site can make, not just the template's defaults", () => {
  render(<TemplateSteps />);

  /* all four ways a fall is stopped */
  shown(/Edge protection along the roof edges/);
  shown(/Work from a scaffold with stair access/);
  shown(/Work from an elevating work platform/);
  shown(/Restraint harness clipped to/);

  /* both ways the dust is controlled, and both silica answers */
  shown(/Core drilled with water fed to the bit/);
  shown(/on-tool extraction to an M- or H-class vacuum/);
  shown(/high-risk processing \(power-tool drilling of brick or concrete\)/);

  /* both states' rules, including the ones only Queensland asks for */
  shown(/Qld Electrical Safety Regulation 2026/);
  shown(/Qld WHS Regulation s 299\(4\)/);
  shown(/at least 3\.0 m from the uninsulated low-voltage line/);
  shown(/at least 4\.0 m from the overhead service line/);

  /* a refrigerant that burns, and one that doesn't */
  shown(/temporary flammable zone around open lines/);
  shown(/Leak checked with an electronic leak detector/);

  /* the site conditions that add a control */
  shown(/treated as possible asbestos/);
  shown(/Hot work permit obtained from the builder/);
});

it("says what a control of each level does, in plain words, each control once", () => {
  const { container } = render(<TemplateSteps />);
  const levels = [...container.querySelectorAll(".sw-lib li > span")].map((s) => s.textContent);
  expect(new Set(levels)).toEqual(new Set(["Removes the hazard", "Safer substitute", "Keeps people clear", "Equipment", "Procedure", "Protective gear"]));

  const texts = [...container.querySelectorAll(".sw-lib li")].map((li) => li.textContent);
  expect(new Set(texts).size).toBe(texts.length);
});

it("tells the reader the options are options", () => {
  render(<TemplateSteps />);
  expect(screen.getByText(/A SWMS prints the ones chosen\./)).toBeInTheDocument();
});
