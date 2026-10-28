/* Settings › Integrations, Email to Tiff (28 October 2026): the business's
   one address, made on a press, copied in one, replaced only on purpose. */
import { act, fireEvent, render, screen } from "@testing-library/react";

const makeTiffEmailAddress = jest.fn();
jest.mock("@/app/actions/email-in", () => ({ makeTiffEmailAddress: () => makeTiffEmailAddress() }));

import { ToastProvider } from "@/components/parts/toast";
import { EmailGroup } from "../email-group";

const draw = (props: Parameters<typeof EmailGroup>[0]) =>
  render(
    <ToastProvider>
      <EmailGroup {...props} />
    </ToastProvider>
  );

beforeEach(() => makeTiffEmailAddress.mockReset());

it("says there's no address yet, and makes one on a press", async () => {
  makeTiffEmailAddress.mockResolvedValue({ ok: true, address: "tiff-k7m2q9xwab@in.hey-tiff.com" });
  draw({ address: null, last: null });
  expect(screen.getByText("No address for Tiff yet")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Make Tiff's address" }));
  });
  expect(screen.getByText("tiff-k7m2q9xwab@in.hey-tiff.com")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Make a new address" })).toBeInTheDocument();
});

it("shows the address, who it's taken from and what came in last, and copies it", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  draw({ address: "tiff-k7m2q9xwab@in.hey-tiff.com", last: { at: "2026-10-29T22:12:00Z", from: "Isaac Smith", subject: "Fw: Tender", refused: false } });
  expect(screen.getByText("Your team, from the email address on their card")).toBeInTheDocument();
  expect(screen.getByText(/from Isaac Smith: Fw: Tender/)).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy the address" }));
  });
  expect(writeText).toHaveBeenCalledWith("tiff-k7m2q9xwab@in.hey-tiff.com");
  expect(screen.getByText("Address copied")).toBeInTheDocument();
});

it("says a refused owner's answer, and keeps the address it had", async () => {
  makeTiffEmailAddress.mockResolvedValue({ ok: false, error: "Only an owner can change Tiff's email address." });
  draw({ address: "tiff-k7m2q9xwab@in.hey-tiff.com", last: null });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
  });
  expect(screen.getByText("Only an owner can change Tiff's email address.")).toBeInTheDocument();
  expect(screen.getByText("tiff-k7m2q9xwab@in.hey-tiff.com")).toBeInTheDocument();
});
