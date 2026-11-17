import { db, getSettings } from "@/lib/db";
import { categoryList, lastActivity, searchPodcasts, stripHtml, type PIFeed } from "@/lib/podcasts";
import { addShowAction, runDiscoveryAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, PageHeader, fmtDate } from "@/components/ui";

export const maxDuration = 300;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string }> }) {
  const { q, msg } = await searchParams;
  const s = await getSettings().catch(() => null);

  let results: PIFeed[] = [];
  let error: string | null = null;
  let known = new Set<string>();
  if (q) {
    try {
      results = await searchPodcasts(q, 30);
      known = new Set(
        (await db()`select podcast_index_id from shows where podcast_index_id is not null`).map((r) => String(r.podcast_index_id)),
      );
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const returnTo = `/discover?q=${encodeURIComponent(q ?? "")}`;

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Find shows from 4M+ podcasts. Adding a show pulls the host email, recent episodes and a fit score, and drafts a pitch if it's a strong fit."
      >
        <form action={runDiscoveryAction}>
          <SubmitButton className="btn-primary" pendingText="Finding shows… (1–2 min)">
            Run auto-discovery
          </SubmitButton>
        </form>
      </PageHeader>
      <Flash msg={msg} />

      {s && (
        <p className="mb-4 text-xs text-muted">
          Auto-discovery searches your saved terms ({s.discovery_terms.join(", ")}), keeps English shows with 15+ episodes active in the
          last 60 days, and adds up to 8 new ones per run. Change terms in Settings.
        </p>
      )}

      <form className="mb-6 flex gap-2" action="/discover">
        <input name="q" defaultValue={q} placeholder="Search podcasts, e.g. CEO leadership interviews" className="input" />
        <button className="btn-primary">Search</button>
      </form>

      {error && <Flash msg={`Search failed: ${error}`} />}
      {q && !error && results.length === 0 && <Empty>No shows found for “{q}”.</Empty>}

      <ul className="space-y-3">
        {results.map((f) => {
          const added = known.has(String(f.id));
          return (
            <li key={f.id} className="card flex gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.artwork || f.image || ""} alt="" className="h-16 w-16 shrink-0 rounded-md bg-paper object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{f.title}</div>
                    <div className="text-xs text-muted">
                      {f.author || f.ownerName} · {f.episodeCount ?? "?"} episodes · last {fmtDate(lastActivity(f))}
                    </div>
                  </div>
                  {added ? (
                    <span className="text-xs text-muted">In pipeline</span>
                  ) : (
                    <form action={addShowAction}>
                      <input type="hidden" name="feedId" value={f.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <SubmitButton pendingText="Adding…">Add & score</SubmitButton>
                    </form>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-ink/80">{stripHtml(f.description ?? "")}</p>
                <p className="mt-1 text-xs text-muted">{categoryList(f)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
