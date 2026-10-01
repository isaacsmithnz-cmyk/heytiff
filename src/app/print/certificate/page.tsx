import { notFound } from "next/navigation";
import { readCertTicket } from "@/lib/certs/pdf-ticket";
import { certPaperProps } from "@/lib/certs/paper-data";
import { CertificatePaper } from "@/components/certs/certificate-paper";
import { PrintReady } from "./print-ready";

/* WHAT THE HEADLESS BROWSER PRINTS — /print/certificate?t=<ticket>.

   The same paper the person's page shows, off the same read. Nobody opens
   this by hand: the issue route sends a headless Chrome here with a ticket
   (lib/certs/pdf-ticket.ts) and waits for the page to say it is ready. The
   ticket is the only authority: a missing, forged or stale one is a 404. */

export const dynamic = "force-dynamic";

export default async function PrintCertificatePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const ticket = readCertTicket(t);
  if (!ticket) notFound();
  const props = await certPaperProps(ticket.orgId, ticket.versionId);
  if (!props) notFound();
  return (
    <>
      <CertificatePaper {...props} />
      <PrintReady />
    </>
  );
}
