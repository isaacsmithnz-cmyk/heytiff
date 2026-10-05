/* A supplier's code letters, read from a maker's document and kept by a
   person (Isaac, 2026-10-05: the Mitsubishi letters were read by hand,
   "not in the app upload"). */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CodeLetters } from "../code-letters";

const read = {
  maker: "Mitsubishi Electric",
  rules: [
    { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", example: { with: "MSZ-AP25VGKD2", without: "MSZ-AP25VGD2" } },
    { family: "MUZ", letter: "D", meaning: "Demand response ready", example: { with: "MUZ-AP25VGD2", without: "MUZ-AP25VG2" } },
  ],
  skipped: [{ said: "Q: Quiet", why: "not a letter and a meaning with an example" }],
};

it("reads a document's letters for a person to look over, and keeps the ticked ones", async () => {
  const sent: { method: string; body: unknown }[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return { json: async () => ({ ok: true, rules: [] }) } as Response;
    sent.push({ method, body: method === "PATCH" ? JSON.parse(String(init!.body)) : (init!.body as FormData).get("supplier") });
    if (method === "POST") return { json: async () => ({ ok: true, read }) } as Response;
    const kept = (JSON.parse(String(init!.body)) as { rules: unknown[] }).rules.map((r, i) => ({ ...(r as object), id: `id-${i}`, supplierKey: "mitsubishi", source: "ME_PriceList.pdf" }));
    return { json: async () => ({ ok: true, rules: kept }) } as Response;
  }) as unknown as typeof fetch;

  render(<CodeLetters supplierKey="mitsubishi" supplierName="Mitsubishi Electric" />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Read Mitsubishi Electric's code letters from a document"), {
      target: { files: [new File(["%PDF"], "ME_PriceList.pdf", { type: "application/pdf" })] },
    });
  });
  expect(await screen.findByRole("heading", { name: "ME_PriceList.pdf, from Mitsubishi Electric" })).toBeInTheDocument();
  expect(screen.getByText("MSZ-AP25VGKD2, without it MSZ-AP25VGD2")).toBeInTheDocument();
  expect(screen.getByText("Not taken: Q: Quiet, not a letter and a meaning with an example.")).toBeInTheDocument();
  /* a person leaves one out */
  fireEvent.click(screen.getByRole("checkbox", { name: "Keep D after VG, in MUZ codes" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Keep 1 rule" }));
  });
  expect(sent[0]).toEqual({ method: "POST", body: "mitsubishi" });
  expect(sent[1]).toEqual({ method: "PATCH", body: { supplier: "mitsubishi", source: "ME_PriceList.pdf", rules: [read.rules[0]] } });
  expect(screen.getByText("Mitsubishi Electric: 1 rule kept.")).toBeInTheDocument();
  expect(screen.getByText("K after VG, in MSZ codes: Wi-Fi built in")).toBeInTheDocument();
  expect(screen.getByText("MSZ-AP25VGKD2 has it, MSZ-AP25VGD2 doesn't; from ME_PriceList.pdf")).toBeInTheDocument();
});

it("shows what's kept, and takes one out", async () => {
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "DELETE") return { json: async () => ({ ok: true }) } as Response;
    return {
      json: async () => ({
        ok: true,
        rules: [{ id: "r-1", supplierKey: "mitsubishi", source: null, family: "MSZ", letter: "K", meaning: "Wi-Fi built in", example: { with: "MSZ-AP25VGKD2", without: "MSZ-AP25VGD2" } }],
      }),
    } as Response;
  }) as unknown as typeof fetch;
  render(<CodeLetters supplierKey="mitsubishi" supplierName="Mitsubishi Electric" />);
  expect(await screen.findByText("K after VG, in MSZ codes: Wi-Fi built in")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Take out" }));
  });
  expect(screen.queryByText("K after VG, in MSZ codes: Wi-Fi built in")).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.at(-1)![0]).toBe("/api/quoting/code-letters?id=r-1");
});
