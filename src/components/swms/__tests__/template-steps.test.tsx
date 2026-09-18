/* WHAT THE OWNER APPROVES. The template page and the wizard's approval screen
   say "every SWMS is written from these steps and controls", so every branch
   the crew can choose on site has to be on the page — it used to be built
   from the default answers alone, which meant the owner never saw the
   harness, the scaffold, the EWP, on-tool extraction, the Queensland clauses
   or the flammable-refrigerant controls. */

import { render, screen, within } from "@testing-library/react";
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
  const levels = [...container.querySelectorAll(".sw-lib li > span:first-child")].map((s) => s.textContent);
  expect(new Set(levels)).toEqual(new Set(["Removes the hazard", "Safer substitute", "Keeps people clear", "Equipment", "Procedure", "Protective gear"]));

  const texts = [...container.querySelectorAll(".sw-lib li")].map((li) => li.textContent);
  expect(new Set(texts).size).toBe(texts.length);
});

/* READ AS ONE METHOD, the merged list contradicted itself — the mains off and
   the RCD circuit left on, four fall protections in a row — under a caption
   excusing it. Each control carries the choice it belongs to instead. */
it("says which choice each control belongs to, and nothing under the ones that always apply", () => {
  const { container } = render(<TemplateSteps />);
  const row = (text: RegExp) => (screen.getByText(text).closest("li") as HTMLElement);

  expect(within(row(/Restraint harness clipped to the named anchor/)).getByText("If a harness is used")).toBeInTheDocument();
  expect(within(row(/Edge protection along the roof edges/)).getByText("If edge protection is used")).toBeInTheDocument();
  expect(within(row(/Only the RCD-protected socket circuit left on/)).getByText("If only the RCD-protected circuit stays on")).toBeInTheDocument();
  expect(within(row(/Qld Electrical Safety Regulation 2026/)).getByText("In Queensland")).toBeInTheDocument();
  expect(within(row(/Higher controls considered first/)).getByText("If a harness is used, in Queensland")).toBeInTheDocument();
  expect(within(row(/Hot work permit obtained from the builder/)).getByText("If a builder runs the site")).toBeInTheDocument();

  /* a control every choice writes says nothing under it */
  expect(within(row(/Industrial ladder rated 120 kg or more/)).queryByText(/^(If|In) /)).toBeNull();
  /* and no caption excusing the list */
  expect(container.textContent).not.toMatch(/A SWMS prints the ones chosen/);
});

/* a stand-in read like the control itself: "by a licensed electrician — the
   electrician." The blanks are named as blanks. */
it("names the blanks a site fills as blanks", () => {
  render(<TemplateSteps />);
  expect(screen.getAllByText(/licensed electrician — the named electrician/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Circuit isolated at the named isolation point/)).toBeInTheDocument();
  expect(screen.getByText(/Restraint harness clipped to the named anchor/)).toBeInTheDocument();
});
