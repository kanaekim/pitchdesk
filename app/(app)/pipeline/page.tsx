import Link from "next/link";
import { db, SHOW_STATUSES } from "@/lib/db";
import { Badge, Empty, FitScore, PageHeader, ShowLink, fmtRelative } from "@/components/ui";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = status && (SHOW_STATUSES as string[]).includes(status) ? status : null;
  const shows = filter
    ? await db()`select * from shows where status = ${filter} order by updated_at desc limit 500`
    : await db()`select * from shows order by updated_at desc limit 500`;
  const counts = Object.fromEntries(
    (await db()`select status, count(*)::int as n from shows group by status`).map((r) => [r.status as string, r.n as number]),
  ) as Record<string, number>;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Pipeline" subtitle={`${total} shows tracked`} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/pipeline" className={`rounded-full px-3 py-1 text-xs ${!filter ? "bg-ink text-white" : "bg-white text-muted"}`}>
          All {total}
        </Link>
        {SHOW_STATUSES.filter((st) => counts[st]).map((st) => (
          <Link
            key={st}
            href={`/pipeline?status=${st}`}
            className={`rounded-full px-3 py-1 text-xs ${filter === st ? "bg-ink text-white" : "bg-white text-muted"}`}
          >
            {st.replace("_", " ")} {counts[st]}
          </Link>
        ))}
      </div>

      {shows.length === 0 ? (
        <Empty>No shows here yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Show</th>
                <th className="px-4 py-2 font-medium">Fit</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Host email</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shows.map((sh) => (
                <tr key={sh.id as number}>
                  <td className="px-4 py-2">
                    <ShowLink id={sh.id as number} title={sh.title as string} />
                    <div className="text-xs text-muted">{sh.author as string}</div>
                  </td>
                  <td className="px-4 py-2">
                    <FitScore score={sh.fit_score as number | null} />
                  </td>
                  <td className="px-4 py-2">
                    <Badge value={sh.status as string} />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{(sh.host_email as string) || "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted">{fmtRelative(sh.updated_at as Date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
