import { fireEvent, render, screen } from "@testing-library/react";
import { WbModal } from "../wb-modal";
import { Inspector } from "../board/inspector";

/* THE WORKBOARD'S MODAL ON THE OVERLAY STACK. It used to say nothing about
   being a dialog, so the inspector beside the board, which steps aside for
   any dialog that is up, did not see it and closed under it on the same
   Escape. */

it("is a dialog named by its title, and Escape closes it and not the inspector under it", () => {
  const modalClosed = jest.fn();
  const panelClosed = jest.fn();
  render(
    <>
      <Inspector label="Wednesday 16 September" title="Wednesday" onClose={panelClosed} />
      <WbModal title="Capacity" onClose={modalClosed}>
        <button>Inside</button>
      </WbModal>
    </>,
  );
  expect(screen.getByRole("dialog", { name: "Capacity" })).toHaveAttribute("aria-modal", "true");
  fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });
  expect(modalClosed).toHaveBeenCalledTimes(1);
  expect(panelClosed).not.toHaveBeenCalled();
});

it("leaves the inspector to answer Escape once nothing is over it", () => {
  const panelClosed = jest.fn();
  render(<Inspector label="Job 2587" title="Job 2587" onClose={panelClosed} />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(panelClosed).toHaveBeenCalledTimes(1);
});
