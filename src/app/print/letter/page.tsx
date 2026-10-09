import { notFound } from "next/navigation";
import { readLetterTicket } from "@/lib/letters/pdf-ticket";
import { letterPaperProps } from "@/lib/letters/query";
import { letterDate, recipientLines } from "@/lib/letters/letter";
import { LetterPaper } from "@/components/letters/letter-paper";
import { LetterBodyView } from "@/components/letters/letter-body";
import { PrintReady } from "../certificate/print-ready";

/* WHAT THE HEADLESS BROWSER PRINTS — /print/letter?t=<ticket>, the
   certificate's arrangement. Nobody opens this by hand: the PDF route sends
   a headless Chrome here with a ticket (lib/letters/pdf-ticket) and waits for
   the page to say it is ready. The ticket is the only authority. */

export const dynamic = "force-dynamic";

export default async function PrintLetterPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const ticket = readLetterTicket(t);
  if (!ticket) notFound();
  const p = await letterPaperProps(ticket.orgId, ticket.letterId, { seconds: 600 });
  if (!p) notFound();
  return (
    <>
      <LetterPaper
        facts={p.facts}
        letterhead={p.letterhead}
        letter={{ date: letterDate(p.letter.date), to: recipientLines(p.letter.recipient), subject: p.letter.subject, signer: p.signer }}
      >
        <LetterBodyView body={p.letter.body} />
      </LetterPaper>
      <PrintReady />
    </>
  );
}
