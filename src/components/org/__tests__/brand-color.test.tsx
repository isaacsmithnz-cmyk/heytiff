import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrandColorPicker } from "../brand-color";

/* The document colour row: a swatch, the hex, Remove. Its value lives on the
   server, so each test re-renders with whatever the last write left — the way
   the page does after revalidation. */
function setup(initial: string | null = null) {
  let value = initial;
  const onSet = jest.fn(async (hex: string) => {
    value = hex;
    return { ok: true as const };
  });
  const onClear = jest.fn(async () => {
    value = null;
    return { ok: true as const };
  });
  const view = () => <BrandColorPicker value={value} onSet={onSet} onClear={onClear} />;
  const utils = render(view());
  return { ...utils, onSet, onClear, refresh: () => utils.rerender(view()) };
}

const swatch = () => screen.getByLabelText("Brand colour") as HTMLInputElement;
const hex = () => screen.getByLabelText("Brand colour hex") as HTMLInputElement;

it("saves a picked colour when the pointer lets go, and shows it in the box", async () => {
  const { onSet, refresh } = setup();
  await act(async () => {
    fireEvent.input(swatch(), { target: { value: "#ff0000" } });
    fireEvent.change(swatch(), { target: { value: "#ff0000" } });
  });
  refresh();
  expect(onSet).toHaveBeenCalledWith("#ff0000");
  expect(hex()).toHaveValue("#ff0000");
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
});

/* A drag across the spectrum is hundreds of `input` events and one `change`:
   saving on every frame would be hundreds of writes for one decision. */
it("does not save while the swatch is still being dragged", async () => {
  const { onSet } = setup();
  await act(async () => {
    fireEvent.input(swatch(), { target: { value: "#112233" } });
    fireEvent.input(swatch(), { target: { value: "#445566" } });
  });
  expect(onSet).not.toHaveBeenCalled();
});

it("saves a typed hex on Enter", async () => {
  const { onSet } = setup();
  await act(async () => {
    fireEvent.change(hex(), { target: { value: "#0a7d3b" } });
    fireEvent.keyDown(hex(), { key: "Enter" });
  });
  expect(onSet).toHaveBeenCalledWith("#0a7d3b");
});

it("refuses something that isn't a colour, and says so without a round trip", async () => {
  const { onSet } = setup();
  await act(async () => {
    fireEvent.change(hex(), { target: { value: "blue" } });
    fireEvent.keyDown(hex(), { key: "Enter" });
  });
  expect(screen.getByText("That isn't a colour — use a hex value like #1a2b4c.")).toBeInTheDocument();
  expect(onSet).not.toHaveBeenCalled();
});

/* Remove cleared the hex box and nothing else: the swatch went on showing the
   removed colour beside a field that said nothing. */
it("puts the swatch and the box back when the colour is removed", async () => {
  const { onClear, refresh } = setup("#ff0000");
  expect(swatch().value).toBe("#ff0000");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  });
  refresh();

  expect(onClear).toHaveBeenCalled();
  expect(swatch().value).not.toBe("#ff0000");
  expect(hex()).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
});
