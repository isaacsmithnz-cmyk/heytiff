export default async function InviteErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <p className="text-sm text-red-500">{msg ?? "Something went wrong with this invite."}</p>
      <a href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-700">
        Go to dashboard
      </a>
    </div>
  );
}
