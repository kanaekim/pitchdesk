// Smart search: a plain-English brief -> many keyword searches -> filter -> enrich -> Claude analysis -> ranked list.
import { db, fromJson, getSettings, json, type Settings } from "./db";
import { claude, parseJson } from "./ai";
import { categoryList, emailFromFeed, lastActivity, latestEpisodes, searchPodcasts, stripHtml, type PIFeed } from "./podcasts";

export const DEFAULT_BRIEF =
  "Podcasts hosted by CEOs, founders or senior executives that discuss business together with IT and technology (AI, digital transformation, SaaS, enterprise tech), whose listeners are CEOs, executives and business owners, and that regularly interview outside guests.";

export interface SmartResult {
  feedId: number;
  title: string;
  author: string | null;
  image: string | null;
  link: string | null;
  description: string;
  categories: string;
  episodeCount: number | null;
  lastEpisodeAt: string | null;
  hostEmail: string | null;
  episodes: { title: string; date: string | null }[];
  termHits: string[];
  guestSignal: number;
  score: number;
  guestFormat: string;
  hostIsExec: string;
  audience: string;
  topics: string[];
  evidence: string;
  reason: string;
}

export interface SmartStats {
  criteria: string[];
  found: number;
  active: number;
  analyzed: number;
  failedTerms: string[];
}

export interface SmartSearch {
  id: number;
  brief: string;
  terms: string[];
  results: SmartResult[];
  stats: SmartStats;
  created_at: Date;
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db()`
    create table if not exists searches (
      id serial primary key,
      brief text not null,
      terms jsonb not null default '[]',
      results jsonb not null default '[]',
      stats jsonb not null default '{}',
      created_at timestamptz not null default now()
    )`;
  tableReady = true;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Episode titles like "The future of AI with Jane Doe" or "Jane Doe, CEO of Acme: ..." suggest an interview show.
const GUEST_WORDS = /\b(with|ft\.?|feat\.?|featuring|interview(s|ed|ing)?|guest|joins|in conversation|sits down|talks to|speaks with)\b/i;
const NAME_PATTERN =
  /(\s[|–—-]\s|:\s|\bwith\s)[A-Z][a-z]+ [A-Z][a-zA-Z'-]+|[A-Z][a-z]+ [A-Z][a-zA-Z'-]+,?\s*(\(|,)?\s*(CEO|CTO|CIO|CFO|COO|Founder|Co-?founder|President|Chair)/;

function guestSignal(titles: string[]): number {
  if (!titles.length) return 0;
  const hits = titles.filter((t) => GUEST_WORDS.test(t) || NAME_PATTERN.test(t)).length;
  return Math.round((hits / titles.length) * 100) / 100;
}

async function planQueries(brief: string): Promise<{ terms: string[]; criteria: string[] }> {
  const text = await claude(
    `You turn a podcast-search brief into keyword queries for the Podcast Index search API. It matches words in podcast titles, author names and descriptions. It is NOT semantic, so long phrases return nothing.
Return 10 queries, each 1 to 3 words. Mix role words (CEO, CIO, CTO, founder, executive, leadership, board), topic words (technology, digital transformation, enterprise tech, SaaS, AI, innovation), and format words (interviews, conversations). Prefer role + topic pairs like "CEO technology" or "CIO leadership". No quotes, no boolean operators, no duplicates.
Also restate the brief as 3 to 5 concrete criteria a researcher can check.
Return only JSON: {"terms": ["..."], "criteria": ["..."]}`,
    brief,
    800,
  );
  const r = parseJson<{ terms?: unknown[]; criteria?: unknown[] }>(text);
  const terms = Array.from(new Set((r.terms ?? []).map((t) => String(t).trim()).filter(Boolean))).slice(0, 10);
  const criteria = (r.criteria ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 5);
  if (!terms.length) throw new Error("Could not turn the brief into search terms.");
  return { terms, criteria };
}

interface Candidate {
  feed: PIFeed;
  termHits: string[];
  episodes: { title: string; description: string; date: string | null }[];
  hostEmail: string | null;
}

interface Analysis {
  id: number;
  score: number;
  guest_format: string;
  host_is_exec: string;
  audience: string;
  topics: string[];
  evidence: string;
  reason: string;
}

async function analyzeBatch(s: Settings, brief: string, criteria: string[], batch: Candidate[]): Promise<Analysis[]> {
  const shows = batch
    .map((c) => {
      const eps = c.episodes
        .map((e) => `   - "${e.title}"${e.date ? ` (${e.date.slice(0, 10)})` : ""}: ${e.description.slice(0, 160)}`)
        .join("\n");
      return `ID: ${c.feed.id}
TITLE: ${c.feed.title}
HOST/AUTHOR: ${c.feed.author || c.feed.ownerName || "unknown"}
CATEGORIES: ${categoryList(c.feed)}
DESCRIPTION: ${stripHtml(c.feed.description ?? "").slice(0, 500)}
EPISODES: ${c.feed.episodeCount ?? "?"} total
GUEST-TITLE SIGNAL: ${Math.round(guestSignal(c.episodes.map((e) => e.title)) * 100)}% of recent titles look like interviews
RECENT EPISODES:
${eps || "   (none)"}`;
    })
    .join("\n\n---\n\n");

  const text = await claude(
    `You are a podcast booking researcher. Judge each podcast against the brief and criteria using ONLY the data given. Do not guess beyond it.

For each podcast decide:
- guest_format: "interviews guests" (most recent episodes feature a named outside guest), "mixed", "solo or co-hosts", or "unclear".
- host_is_exec: "yes" if the host is clearly a CEO, founder or senior executive, "no" if clearly not, otherwise "unknown".
- audience: who listens, in a few words.
- topics: 2 to 4 short topic tags.
- evidence: quote 1 or 2 real episode titles that support your judgment.
- reason: one sentence on why it is or is not a fit for booking the guest below.
- score 0-100: 90+ near-perfect (executive audience, business plus technology, interviews guests, active), 70-89 good, 50-69 partial, under 50 poor.
Hard rules: a show that does not interview outside guests cannot score above 55. Pure consumer tech, gadget reviews, coding tutorials, crypto trading and entertainment score under 40.

Return only JSON: {"results": [{"id": 123, "score": 0, "guest_format": "", "host_is_exec": "", "audience": "", "topics": [], "evidence": "", "reason": ""}]}`,
    `BRIEF:\n${brief}\n\nCRITERIA:\n${criteria.map((c) => `- ${c}`).join("\n")}\n\nGUEST WE WANT TO BOOK: ${s.guest_name}. ${s.offer.slice(0, 400)}\n\n=== PODCASTS ===\n\n${shows}`,
    3500,
  );
  const r = parseJson<{ results?: Analysis[] }>(text);
  return r.results ?? [];
}

export async function runSmartSearch(brief: string): Promise<number> {
  await ensureTable();
  const s = await getSettings();
  const { terms, criteria } = await planQueries(brief);

  // 1. Search every term in parallel.
  const settled = await Promise.allSettled(terms.map((t) => searchPodcasts(t, 50)));
  const failedTerms: string[] = [];
  const byId = new Map<number, { feed: PIFeed; termHits: string[] }>();
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      failedTerms.push(terms[i]);
      return;
    }
    for (const f of r.value) {
      const hit = byId.get(f.id);
      if (hit) hit.termHits.push(terms[i]);
      else byId.set(f.id, { feed: f, termHits: [terms[i]] });
    }
  });
  if (failedTerms.length === terms.length) {
    const first = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error((first?.reason as Error)?.message ?? "All searches failed.");
  }

  // 2. Keep active English shows with some history; rank by how many searches found them, then recency.
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  const active = [...byId.values()].filter(({ feed }) => {
    const last = lastActivity(feed);
    if (!last || last.getTime() < cutoff) return false;
    if ((feed.episodeCount ?? 0) < 10) return false;
    if (feed.language && !feed.language.toLowerCase().startsWith("en")) return false;
    return true;
  });
  active.sort(
    (a, b) =>
      b.termHits.length - a.termHits.length ||
      (lastActivity(b.feed)?.getTime() ?? 0) - (lastActivity(a.feed)?.getTime() ?? 0),
  );
  const shortlist = active.slice(0, 40);

  // 3. Enrich with recent episodes and the host email from the RSS feed.
  const candidates: Candidate[] = await mapLimit(shortlist, 8, async ({ feed, termHits }) => {
    const [episodes, hostEmail] = await Promise.all([
      latestEpisodes(feed.id, 8).catch(() => []),
      emailFromFeed(feed.url).catch(() => null),
    ]);
    return { feed, termHits, episodes, hostEmail };
  });

  // 4. Analyze in batches of 8, in parallel.
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += 8) batches.push(candidates.slice(i, i + 8));
  const analyses = new Map<number, Analysis>();
  await Promise.all(
    batches.map(async (b) => {
      try {
        for (const a of await analyzeBatch(s, brief, criteria, b)) analyses.set(Number(a.id), a);
      } catch {
        // leave these unscored; they show at the bottom
      }
    }),
  );

  const results: SmartResult[] = candidates.map((c) => {
    const a = analyses.get(c.feed.id);
    return {
      feedId: c.feed.id,
      title: c.feed.title,
      author: c.feed.author || c.feed.ownerName || null,
      image: c.feed.artwork || c.feed.image || null,
      link: c.feed.link || null,
      description: stripHtml(c.feed.description ?? "").slice(0, 400),
      categories: categoryList(c.feed),
      episodeCount: c.feed.episodeCount ?? null,
      lastEpisodeAt: lastActivity(c.feed)?.toISOString() ?? null,
      hostEmail: c.hostEmail,
      episodes: c.episodes.slice(0, 6).map((e) => ({ title: e.title, date: e.date })),
      termHits: c.termHits,
      guestSignal: guestSignal(c.episodes.map((e) => e.title)),
      score: a ? Math.max(0, Math.min(100, Math.round(Number(a.score) || 0))) : -1,
      guestFormat: a?.guest_format ?? "unclear",
      hostIsExec: a?.host_is_exec ?? "unknown",
      audience: a?.audience ?? "",
      topics: Array.isArray(a?.topics) ? a!.topics.map(String).slice(0, 4) : [],
      evidence: a?.evidence ?? "",
      reason: a?.reason ?? "Not analyzed (the analysis call failed). Try again.",
    };
  });
  results.sort((x, y) => y.score - x.score);

  const stats: SmartStats = {
    criteria,
    found: byId.size,
    active: active.length,
    analyzed: analyses.size,
    failedTerms,
  };
  const rows = await db()`
    insert into searches (brief, terms, results, stats)
    values (${brief}, ${json(terms)}, ${json(results)}, ${json(stats)})
    returning id`;
  return rows[0].id as number;
}

export async function getSearch(id: number): Promise<SmartSearch | null> {
  await ensureTable();
  const rows = await db()`select * from searches where id = ${id}`;
  if (!rows.length) return null;
  const r = rows[0];
  const stats = fromJson<Partial<SmartStats>>(r.stats, {});
  return {
    id: r.id as number,
    brief: r.brief as string,
    terms: fromJson<string[]>(r.terms, []),
    results: fromJson<SmartResult[]>(r.results, []),
    stats: { criteria: [], found: 0, active: 0, analyzed: 0, failedTerms: [], ...stats },
    created_at: r.created_at as Date,
  };
}

export async function recentSearches(limit = 6): Promise<{ id: number; brief: string; created_at: Date; n: number }[]> {
  await ensureTable();
  const rows = await db()`
    select id, brief, created_at, results from searches order by created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as number,
    brief: r.brief as string,
    created_at: r.created_at as Date,
    n: fromJson<unknown[]>(r.results, []).length,
  }));
}
