import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Revise3D, type Reviser } from "../revise-3d";
import type { RoofReading } from "@/lib/studio/reading";

/* Telling Tiff what's wrong with the 3D (Isaac, 20 October 2026: "She
   should also be able to revise 3d renderings if you are not happy"). */

const ROOF: RoofReading = { levels: [], parts: [], raked: [], material: "tile", roofSpace: "" };

function setup(reviser: Reviser) {
  const onRoof = jest.fn();
  const onUndo = jest.fn();
  const user = userEvent.setup();
  render(<Revise3D designId="dsn_1" onRoof={onRoof} onUndo={onUndo} reviser={reviser} />);
  return { user, onRoof, onUndo };
}

it("sends what's wrong, keeps the corrected roof, says what she changed, and offers Undo", async () => {
  const reviser = jest.fn<ReturnType<Reviser>, Parameters<Reviser>>(async () => ({ ok: true, roof: ROOF, said: "Made it a hip at 25°." }));
  const { user, onRoof, onUndo } = setup(reviser);
  await user.type(screen.getByRole("textbox", { name: "What's wrong with the 3D" }), "it's a hip roof at 25");
  await user.click(screen.getByRole("button", { name: "Change it" }));
  expect(reviser).toHaveBeenCalledWith("dsn_1", "it's a hip roof at 25");
  expect(onRoof).toHaveBeenCalledWith(ROOF);
  expect(await screen.findByText("Made it a hip at 25°.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalled();
});

it("says why when she couldn't, and changes nothing", async () => {
  const { user, onRoof } = setup(async () => ({ ok: false, error: "Tiff couldn't change it this time." }));
  await user.type(screen.getByRole("textbox", { name: "What's wrong with the 3D" }), "flat roof{Enter}");
  expect(await screen.findByText("Tiff couldn't change it this time.")).toBeInTheDocument();
  expect(onRoof).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("asks nothing with no words", async () => {
  const reviser = jest.fn();
  setup(reviser);
  expect(screen.getByRole("button", { name: "Change it" })).toBeDisabled();
});
