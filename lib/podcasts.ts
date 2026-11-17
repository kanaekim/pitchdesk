import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import type { Episode } from "./db";

const PI = "https://api.podcastindex.org/api/1.0";

export interface PIFeed {
  id: number;
  title: string;
  url: string;
  link?: string;
  description?: string;
  author?: string;
  ownerName?: string;
  image?: string;
  artwork?: string;
  lastUpdateTime?: number;
  newestItemPublishTime?: number;
  episodeCount?: number;
  language?: string;
  categories?: Record<string, string> | null;
  dead?: number;
}

async function pi<T>(path: string): Promise<T> {
  const key = process.env.PODCASTINDEX_KEY;
  const secret = process.env.PODCASTINDEX_SECRET;
  if (!key || !secret) throw new Error("PODCASTINDEX_KEY and PODCASTINDEX_SECRET are not set.");
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = createHash("sha1").update(key + secret + date).digest("hex");
  const res = await fetch(`${PI}${path}`, {
    headers: {
      "User-Agent": "PitchDesk/1.0",
      "X-Auth-Key": key,
      "X-Auth-Date": date,
      Authorization: auth,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Podcast Index ${res.status}`);
  return (await res.json()) as T;
}

export async function searchPodcasts(term: string, max = 40): Promise<PIFeed[]> {
  const data = await pi<{ feeds?: PIFeed[] }>(`/search/byterm?q=${encodeURIComponent(term)}&max=${max}&clean`);
  return (data.feeds ?? []).filter((f) => !f.dead);
}

export async function podcastById(id: number | string): Promise<PIFeed | null> {
  const data = await pi<{ feed?: PIFeed | [] }>(`/podcasts/byfeedid?id=${id}`);
  return data.feed && !Array.isArray(data.feed) ? data.feed : null;
}

export async function latestEpisodes(id: number | string, max = 5): Promise<Episode[]> {
  const data = await pi<{ items?: { title: string; description?: string; datePublished?: number; link?: string }[] }>(
    `/episodes/byfeedid?id=${id}&max=${max}`,
  );
  return (data.items ?? []).map((e) => ({
    title: e.title,
    description: stripHtml(e.description ?? "").slice(0, 600),
    date: e.datePublished ? new Date(e.datePublished * 1000).toISOString() : null,
    link: e.link ?? null,
  }));
}

export function stripHtml(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function lastActivity(f: PIFeed): Date | null {
  const t = f.newestItemPublishTime || f.lastUpdateTime;
  return t ? new Date(t * 1000) : null;
}

export function categoryList(f: PIFeed): string {
  return f.categories ? Object.values(f.categories).join(", ") : "";
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// The host's contact email usually lives in the RSS feed's <itunes:email> (inside <itunes:owner>).
export async function emailFromFeed(feedUrl: string): Promise<string | null> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "PitchDesk/1.0 (+podcast guest outreach)" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    // Only the channel header matters; avoid parsing multi-megabyte feeds.
    const text = (await res.text()).slice(0, 200_000);
    const candidates = [
      text.match(/<itunes:email>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i)?.[1],
      text.match(/<googleplay:email>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i)?.[1],
      text.match(/<managingEditor>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)/i)?.[1]?.match(EMAIL_RE)?.[0],
      text.match(/<webMaster>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)/i)?.[1]?.match(EMAIL_RE)?.[0],
    ];
    for (const c of candidates) {
      if (c && EMAIL_RE.test(c)) return c.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

// Emails that usually go to a hosting platform, not the host.
const PLATFORM_DOMAINS = ["anchor.fm", "spotify.com", "podbean.com", "buzzsprout.com", "libsyn.com", "megaphone.fm", "acast.com", "simplecast.com", "omny.fm", "transistor.fm", "captivate.fm", "redcircle.com", "spreaker.com", "iheart.com"];

export async function verifyEmail(email: string): Promise<"valid" | "invalid" | "risky" | "unknown"> {
  if (!EMAIL_RE.test(email)) return "invalid";
  const domain = email.split("@")[1].toLowerCase();
  if (PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return "risky";

  const zbKey = process.env.ZEROBOUNCE_API_KEY;
  if (zbKey) {
    try {
      const res = await fetch(
        `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(zbKey)}&email=${encodeURIComponent(email)}&ip_address=`,
        { signal: AbortSignal.timeout(10000) },
      );
      const json = (await res.json()) as { status?: string };
      if (json.status === "valid") return "valid";
      if (json.status === "invalid" || json.status === "spamtrap" || json.status === "abuse" || json.status === "do_not_mail") return "invalid";
      if (json.status === "catch-all") return "risky";
      return "unknown";
    } catch {
      // fall through to MX check
    }
  }
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length ? "unknown" : "invalid";
  } catch {
    return "invalid";
  }
}
