import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrandColorPicker } from "../brand-color";

/* The document colour, and the miniature sheet it repaints. Its value lives on
   the server, so each test re-renders with whatever the last write left — the
   way the page does after revalidation. */
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
  const view = () => (
    <BrandColorPicker value={value} name="Blue Sky Air" abn="51 824 753 556" onSet={onSet} onClear={onClear} />
  );
  const utils = render(view());
  const band = () => (utils.container.querySelector(".orgcol-band") as HTMLElement).style.background;
  return { ...utils, onSet, onClear, band, refresh: () => utils.rerender(view()) };
}

it("frames the sheet in the colour once one is picked", async () => {
  const { band, refresh, onSet } = setup();
  expect(band()).toBe("transparent");

  const swatch = screen.getByLabelText("Brand colour");
  await act(async () => {
    fireEvent.input(swatch, { target: { value: "#ff0000" } });
    fireEvent.change(swatch, { target: { value: "#ff0000" } });
  });
  refresh();
  expect(onSet).toHaveBeenCalledWith("#ff0000");
  expect(band()).not.toBe("transparent");
});

/* Remove cleared the hex box and nothing else: once the picker had been
   touched, the sheet went on drawing the removed colour's frame and the
   swatch went on showing it — a preview of a document nobody can now get. */
it("takes the frame off the sheet when the colour is removed", async () => {
  const { band, refresh } = setup();
  const swatch = screen.getByLabelText("Brand colour") as HTMLInputElement;
  await act(async () => {
    fireEvent.input(swatch, { target: { value: "#ff0000" } });
    fireEvent.change(swatch, { target: { value: "#ff0000" } });
  });
  refresh();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  });
  refresh();

  expect(band()).toBe("transparent");
  expect(swatch.value).not.toBe("#ff0000");
  expect(screen.getByLabelText("Brand colour hex")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
});

it("prints the business's own name and ABN on separate lines", () => {
  const { container } = setup();
  const lines = Array.from(container.querySelectorAll(".orgcol-page span")).map((s) => s.textContent);
  expect(lines).toEqual(["Blue Sky Air", "ABN 51 824 753 556"]);
});
