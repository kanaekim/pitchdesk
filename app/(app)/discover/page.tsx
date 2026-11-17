import Link from "next/link";
import type { ReactNode } from "react";
import { db, getSettings } from "@/lib/db";
import { categoryList, lastActivity, searchPodcasts, stripHtml, type PIFeed } from "@/lib/podcasts";
import { DEFAULT_BRIEF, getSearch, recentSearches, type SmartResult } from "@/lib/smart";
import { addShowAction, addTopAction, runDiscoveryAction, smartSearchAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, FitScore, PageHeader, fmtDate, fmtRelative } from "@/components/ui";

export const maxDuration = 300;

const FORMAT_STYLE: Record<string, string> = {
  "interviews guests": "bg-good-soft text-good",
  mixed: "bg-warn-soft text-warn",
  "solo or co-hosts": "bg-bad-soft text-bad",
  unclear: "bg-paper text-muted",
};

function Pill({ children, className = "bg-paper text-muted" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>;
}

function ResultCard({ r, inPipeline, returnTo }: { r: SmartResult; inPipeline: boolean; returnTo: string }) {
  return (
    <li className="card p-4">
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.image ?? ""} alt="" className="h-16 w-16 shrink-0 rounded-md bg-paper object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FitScore score={r.score >= 0 ? r.score : null} />
                <span className="font-medium">{r.title}</span>
              </div>
              <div className="text-xs text-muted">
                {r.author} · {r.episodeCount ?? "?"} episodes · last {fmtDate(r.lastEpisodeAt)}
                {r.link && (
                  <>
                    {" · "}
                    <a href={r.link} target="_blank" rel="noreferrer" className="underline">
                      website
                    </a>
                  </>
                )}
              </div>
            </div>
            {inPipeline ? (
              <span className="text-xs text-muted">In pipeline</span>
            ) : (
              <form action={addShowAction}>
                <input type="hidden" name="feedId" value={r.feedId} />
                <input type="hidden" name="fitScore" value={r.score} />
                <input type="hidden" name="fitReason" value={r.reason} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <SubmitButton pendingText="Adding…">Add to pipeline</SubmitButton>
              </form>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill className={FORMAT_STYLE[r.guestFormat] ?? FORMAT_STYLE.unclear}>{r.guestFormat}</Pill>
            <Pill className={r.hostIsExec === "yes" ? "bg-good-soft text-good" : "bg-paper text-muted"}>
              exec host: {r.hostIsExec}
            </Pill>
            <Pill className={r.hostEmail ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}>
              {r.hostEmail ? "host email found" : "no email in feed"}
            </Pill>
            {r.topics.map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>

          <p className="mt-2 text-sm">{r.reason}</p>
          {r.audience && <p className="mt-1 text-xs text-muted">Audience: {r.audience}</p>}
          {r.evidence && <p className="mt-1 text-xs text-muted italic">Evidence: {r.evidence}</p>}

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">Recent episodes and details</summary>
            <ul className="mt-2 space-y-1">
              {r.episodes.map((e, i) => (
                <li key={i}>
                  {e.title} <span className="text-muted">· {fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted">{r.description}</p>
            <p className="mt-1 text-muted">
              {r.categories} · found by: {r.termHits.join(", ")} · interview-style titles: {Math.round(r.guestSignal * 100)}%
            </p>
          </details>
        </div>
      </div>
    </li>
  );
}

async function knownIds(): Promise<Set<string>> {
  try {
    const rows = await db()`select podcast_index_id from shows where podcast_index_id is not null`;
    return new Set(rows.map((r) => String(r.podcast_index_id)));
  } catch {
    return new Set();
  }
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; msg?: string; sid?: string; min?: string; guests?: string }>;
}) {
  const { q, msg, sid, min, guests } = await searchParams;
  const s = await getSettings().catch(() => null);
  const known = await knownIds();

  const search = sid ? await getSearch(Number(sid)).catch(() => null) : null;
  const recent = await recentSearches().catch(() => []);
  const minScore = Number(min ?? 0) || 0;
  const guestsOnly = guests === "1";
  const shown = search
    ? search.results.filter((r) => r.score >= minScore && (!guestsOnly || r.guestFormat === "interviews guests"))
    : [];
  const base = search ? `/discover?sid=${search.id}` : "/discover";
  const filterHref = (m: number, g: boolean) => `${base}&min=${m}${g ? "&guests=1" : ""}`;
  const returnTo = search ? filterHref(minScore, guestsOnly) : "/discover";

  // Quick keyword search (the old simple mode).
  let results: PIFeed[] = [];
  let error: string | null = null;
  if (q) {
    try {
      results = await searchPodcasts(q, 30);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <>
      <PageHeader title="Discover" subtitle="Describe the shows you want. PitchDesk searches widely, reads recent episodes, and ranks every show for fit." />
      <Flash msg={msg} />

      <section className="card mb-6 p-5">
        <form action={smartSearchAction}>
          <label className="label" htmlFor="brief">
            What kind of shows?
          </label>
          <textarea id="brief" name="brief" rows={3} className="input" defaultValue={search?.brief ?? DEFAULT_BRIEF} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SubmitButton className="btn-primary" pendingText="Searching and analyzing… (about a minute)">
              Find & analyze
            </SubmitButton>
            <span className="text-xs text-muted">
              Runs about 10 searches, checks up to 40 active shows, reads 8 recent episodes each, and scores them with Claude.
            </span>
          </div>
        </form>
        {recent.length > 0 && (
          <div className="mt-4 border-t border-line pt-3 text-xs">
            <span className="text-muted">Recent: </span>
            {recent.map((r, i) => (
              <span key={r.id}>
                {i > 0 && <span className="text-muted"> · </span>}
                <Link href={`/discover?sid=${r.id}`} className={`hover:underline ${search?.id === r.id ? "font-semibold" : ""}`}>
                  {r.brief.slice(0, 50)}
                  {r.brief.length > 50 ? "…" : ""}
                </Link>{" "}
                <span className="text-muted">({r.n}, {fmtRelative(r.created_at)})</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {search && (
        <section className="mb-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                {search.results.length} shows analyzed · {search.results.filter((r) => r.score >= 70).length} strong fits
              </h2>
              <p className="text-xs text-muted">
                Searched: {search.terms.join(", ")}. Found {search.stats.found} shows, {search.stats.active} active.
                {search.stats.failedTerms?.length ? ` ${search.stats.failedTerms.length} searches failed.` : ""}
              </p>
              {(search.stats.criteria?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-muted">Criteria: {search.stats.criteria.join(" · ")}</p>
              )}
            </div>
            <form action={addTopAction}>
              <input type="hidden" name="sid" value={search.id} />
              <input type="hidden" name="min" value={80} />
              <SubmitButton className="btn-primary" pendingText="Adding and drafting…">
                Add all 80+ with email
              </SubmitButton>
            </form>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
            {[0, 60, 70, 80].map((m) => (
              <Link
                key={m}
                href={filterHref(m, guestsOnly)}
                className={`rounded-full px-3 py-1 ${minScore === m ? "bg-ink text-white" : "bg-white text-muted"}`}
              >
                {m === 0 ? "All" : `${m}+`}
              </Link>
            ))}
            <Link
              href={filterHref(minScore, !guestsOnly)}
              className={`rounded-full px-3 py-1 ${guestsOnly ? "bg-ink text-white" : "bg-white text-muted"}`}
            >
              Interviews guests only
            </Link>
          </div>

          {shown.length === 0 ? (
            <Empty>No shows match these filters.</Empty>
          ) : (
            <ul className="space-y-3">
              {shown.map((r) => (
                <ResultCard key={r.feedId} r={r} inPipeline={known.has(String(r.feedId))} returnTo={returnTo} />
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="card p-5" open={!!q}>
        <summary className="cursor-pointer text-sm font-semibold">Quick keyword search and auto-discovery</summary>
        <div className="mt-4">
          <form className="mb-4 flex gap-2" action="/discover">
            <input name="q" defaultValue={q} placeholder="Short keywords, e.g. CEO technology" className="input" />
            <button className="btn-primary">Search</button>
          </form>
          <form action={runDiscoveryAction} className="mb-4">
            <SubmitButton pendingText="Finding shows… (1–2 min)">Run auto-discovery on saved terms</SubmitButton>
            {s && <span className="ml-2 text-xs text-muted">{s.discovery_terms.join(", ")}</span>}
          </form>

          {error && <Flash msg={`Search failed: ${error}`} />}
          {q && !error && results.length === 0 && <Empty>No shows found for “{q}”. Try fewer words.</Empty>}
          <ul className="space-y-3">
            {results.map((f) => (
              <li key={f.id} className="flex gap-4 rounded-lg border border-line p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.artwork || f.image || ""} alt="" className="h-12 w-12 shrink-0 rounded-md bg-paper object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{f.title}</div>
                      <div className="text-xs text-muted">
                        {f.author || f.ownerName} · {f.episodeCount ?? "?"} episodes · last {fmtDate(lastActivity(f))}
                      </div>
                    </div>
                    {known.has(String(f.id)) ? (
                      <span className="text-xs text-muted">In pipeline</span>
                    ) : (
                      <form action={addShowAction}>
                        <input type="hidden" name="feedId" value={f.id} />
                        <input type="hidden" name="returnTo" value={`/discover?q=${encodeURIComponent(q ?? "")}`} />
                        <SubmitButton pendingText="Adding…">Add & score</SubmitButton>
                      </form>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-ink/80">{stripHtml(f.description ?? "")}</p>
                  <p className="mt-1 text-xs text-muted">{categoryList(f)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
