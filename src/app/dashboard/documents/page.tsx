import { Suspense } from "react";
import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadDocuments } from "@/lib/documents/made-query";
import { readDocsState } from "@/lib/documents/made";
import { DocumentsList } from "@/components/documents/documents-list";
import { Loading } from "@/components/parts/states";

/* DOCUMENTS (v2, step 5; the board 5-documents). What the business has
   made: its SWMS, certificates, letters and handover sheets, by kind, with
   the Templates in the rail and Make a document. Quotes are not listed: a
   quote lives on its job.

   Gated like the Workboard, by `workboard`, which is the gate on the SWMS,
   the certificates and the handover sheets today; Letters inside it stay
   admin and up, held back by the query. The view, the person, the sort and
   the search ride in the address, so a tab holds them.

   The wait is the page's own Suspense, as Jobs has it (rule 41). */

type Params = Promise<Record<string, string | string[] | undefined>>;

async function DocumentsBody({ searchParams }: { searchParams: Params }) {
  const data = await loadDocuments();
  if (!data) redirect("/dashboard");
  const initial = readDocsState(await searchParams, data.kinds);
  return <DocumentsList data={data} initial={initial} />;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Params }) {
  if (!(await can("workboard"))) redirect("/dashboard");
  return (
    <Suspense
      fallback={
        <div className="dc2">
          <Loading what="Loading documents" shape="rows" count={8} />
        </div>
      }
    >
      <DocumentsBody searchParams={searchParams} />
    </Suspense>
  );
}
