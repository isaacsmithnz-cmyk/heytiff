import { redirect } from "next/navigation";

/* THE DESK, RETIRED (Isaac, 24 October 2026: the desk's last doors moved to
   Home). Its faces have their v2 homes: a task opens its own form over Home,
   a mention is answered in Your feed, a field issue with nothing to open is
   made a task or Done there, and the Calendar is the Schedule's month. An
   old link still lands: a task on Home with its form open, an ask on its
   mention's reply, the Calendar on the Schedule, the rest on Home. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (v: string | string[] | undefined): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export default async function DeskPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = await searchParams;
  const task = one(search?.task);
  const ask = one(search?.ask);
  if (task) redirect(`/dashboard?task=${task}`);
  if (ask) redirect(`/dashboard?reply=${ask}`);
  redirect(search?.face === "calendar" ? "/dashboard/schedule" : "/dashboard");
}
