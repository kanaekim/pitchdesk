// Host enrichment.
// Tier 1 (free): identify the host from the feed + episodes, and read the show's website for
//   LinkedIn links, published emails, contact pages and guest forms.
// Tier 2 (search API): find the host's LinkedIn profile when the website doesn't link it.
// Apollo (optional): look up the host's direct work email, LinkedIn and location for every show where the host is known.
// Found contacts are added alongside the published one, never in place of it.
import { db, fromJson, json, logActivity, type Episode, type Show } from "./db";
import { claude, parseJson } from "./ai";
import { podcastById, stripHtml, verifyEmail } from "./podcasts";

export interface ContactEmail {
  email: string;
  source: "rss" | "website" | "apollo";
  status?: string | null;
  url?: string | null;
}

let migrated = false;
export async function ensureEnrichColumns() {
  if (migrated) return;
  await db().unsafe(`
    alter table shows add column if not exists host_name text;
    alter table shows add column if not exists host_title text;
    alter table shows add column if not exists host_company text;
    alter table shows add column if not exists host_domain text;
    alter table shows add column if not exists host_linkedin text;
    alter table shows add column if not exists host_linkedin_source text;
    alter table shows add column if not exists host_confidence text;
    alter table shows add column if not exists contact_page_url text;
    alter table shows add column if not exists guest_form_url text;
    alter table shows add column if not exists contact_emails jsonb not null default '[]';
    alter table shows add column if not exists enrich_notes text;
    alter table shows add column if not exists enriched_at timestamptz;
    alter table shows add column if not exists host_bio text;
    alter table shows add column if not exists host_location text;
    alter table shows add column if not exists host_headline text;
  `);
  migrated = true;
}

export function searchProvider(): "Serper" | "Brave" | null {
  if (process.env.SERPER_API_KEY) return "Serper";
  if (process.env.BRAVE_SEARCH_API_KEY) return "Brave";
  return null;
}

export function apolloEnabled() {
  return !!process.env.APOLLO_API_KEY;
}

// ---------- website reading ----------

const UA = "Mozilla/5.0 (compatible; PitchDesk/1.0; podcast guest outreach)";

async function fetchHtml(url: string): Promise<{ html: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    return { html: (await res.text()).slice(0, 400_000), url: res.url || url };
  } catch {
    return null;
  }
}

function abs(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function links(html: string, base: string) {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 1000) {
    const href = abs(m[1].trim(), base);
    if (href) out.push({ href, text: stripHtml(m[2]).slice(0, 80) });
  }
  return out;
}

function visibleText(html: string) {
  return stripHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
  );
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JUNK_EMAIL = /(example\.|sentry|wixpress|domain\.com|email\.com|yourdomain|noreply|no-reply|\.(png|jpe?g|gif|webp|svg)$)/i;

function emailsIn(html: string, pageLinks: { href: string }[]): string[] {
  const found = new Set<string>();
  for (const l of pageLinks) {
    if (l.href.toLowerCase().startsWith("mailto:")) {
      const e = decodeURIComponent(l.href.slice(7).split("?")[0]).trim().toLowerCase();
      if (e) found.add(e);
    }
  }
  for (const e of visibleText(html).match(EMAIL_RE) ?? []) found.add(e.toLowerCase());
  return [...found].filter((e) => !JUNK_EMAIL.test(e)).slice(0, 6);
}

function normalizeLinkedIn(url: string): string | null {
  const m = url.match(/linkedin\.com\/(in|company)\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}` : null;
}

const CONTACT_WORDS = /(contact|guest|be-a-guest|be-on|booking|book-|apply|pitch|submit|speaker|work-with|get-in-touch)/i;
const FORM_HOSTS = /(forms\.gle|docs\.google\.com\/forms|typeform\.com|jotform\.com|airtable\.com\/(shr|app)|tally\.so|forms\.office\.com|hsforms|cognitoforms|formstack|podmatch\.com|matchmaker\.fm)/i;

interface SiteFindings {
  homepage: string | null;
  text: string;
  linkedins: string[];
  emails: { email: string; url: string }[];
  contactPage: string | null;
  guestForm: string | null;
}

async function readWebsite(link: string | null): Promise<SiteFindings> {
  const empty: SiteFindings = { homepage: null, text: "", linkedins: [], emails: [], contactPage: null, guestForm: null };
  if (!link || !/^https?:/i.test(link)) return empty;
  const home = await fetchHtml(link);
  if (!home) return empty;

  const host = new URL(home.url).host;
  const homeLinks = links(home.html, home.url);
  const linkedins = new Set<string>();
  const emails: { email: string; url: string }[] = [];
  let guestForm: string | null = null;
  let contactPage: string | null = null;

  const scan = (html: string, url: string, pageLinks: { href: string; text: string }[]) => {
    for (const l of pageLinks) {
      const li = normalizeLinkedIn(l.href);
      if (li) linkedins.add(li);
      if (!guestForm && FORM_HOSTS.test(l.href)) guestForm = l.href;
    }
    for (const e of emailsIn(html, pageLinks)) if (!emails.some((x) => x.email === e)) emails.push({ email: e, url });
  };
  scan(home.html, home.url, homeLinks);

  // Follow up to two same-site contact/guest pages.
  const candidates = homeLinks
    .filter((l) => {
      try {
        return new URL(l.href).host === host && (CONTACT_WORDS.test(l.href) || CONTACT_WORDS.test(l.text));
      } catch {
        return false;
      }
    })
    .map((l) => l.href.split("#")[0])
    .filter((h, i, arr) => arr.indexOf(h) === i && h !== home.url)
    .sort((a, b) => Number(/guest|apply|pitch|be-a/i.test(b)) - Number(/guest|apply|pitch|be-a/i.test(a)))
    .slice(0, 2);

  let extraText = "";
  for (const url of candidates) {
    const page = await fetchHtml(url);
    if (!page) continue;
    const pageLinks = links(page.html, page.url);
    scan(page.html, page.url, pageLinks);
    if (!contactPage) contactPage = page.url;
    if (!guestForm && /<form\b/i.test(page.html) && /guest|apply|pitch|be-a/i.test(page.url)) guestForm = page.url;
    extraText += ` ${visibleText(page.html).slice(0, 1200)}`;
  }

  return {
    homepage: home.url,
    text: `${visibleText(home.html).slice(0, 2500)} ${extraText}`.trim(),
    linkedins: [...linkedins].slice(0, 12),
    emails,
    contactPage,
    guestForm,
  };
}

// ---------- host identification ----------

interface HostGuess {
  host_name: string | null;
  host_title: string | null;
  host_company: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  confidence: "high" | "medium" | "low";
  bio: string | null;
  notes: string;
}

async function identifyHost(show: Show, ownerName: string | null, site: SiteFindings): Promise<HostGuess> {
  const eps = fromJson<Episode[]>(show.latest_episodes, [])
    .slice(0, 6)
    .map((e) => `- "${e.title}": ${e.description.slice(0, 200)}`)
    .join("\n");
  const text = await claude(
    `Identify the main host of a podcast from the data given. Use only this data and do not invent anything.
- host_name: the host's full name (first and last) if stated, else null. If the show is run by a company or network with no named host, use null.
- host_title and host_company: the host's role and company if stated (e.g. "CEO", "Acme Corp"), else null.
- company_domain: the company's website domain only if it appears in the data (in an email address or URL), else null.
- linkedin_url: pick the URL from LINKEDIN LINKS that belongs to the host (a /in/ profile whose slug matches the name). Use null if none clearly match. Never make one up.
- confidence: "high" if the name is stated explicitly, "medium" if inferred from several clues, "low" otherwise.
- bio: two or three plain sentences about the host for a booking researcher: who they are, what they do, how long they have hosted, what the show covers. Only facts from the data. Third person. null if the host is unknown.
- notes: one short sentence on how you know.
Return only JSON: {"host_name": null, "host_title": null, "host_company": null, "company_domain": null, "linkedin_url": null, "confidence": "low", "bio": null, "notes": ""}`,
    `PODCAST: ${show.title}
FEED AUTHOR: ${show.author ?? "unknown"}
FEED OWNER NAME: ${ownerName ?? "unknown"}
FEED EMAIL: ${show.host_email ?? "none"}
DESCRIPTION: ${(show.description ?? "").slice(0, 1200)}
RECENT EPISODES:
${eps || "(none)"}
WEBSITE: ${site.homepage ?? "none"}
WEBSITE EMAILS: ${site.emails.map((e) => e.email).join(", ") || "none"}
LINKEDIN LINKS:
${site.linkedins.join("\n") || "(none)"}
WEBSITE TEXT:
${site.text.slice(0, 3500) || "(not available)"}`,
    800,
  );
  const r = parseJson<Partial<HostGuess>>(text);
  const clean = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);
  const li = clean(r.linkedin_url);
  return {
    host_name: clean(r.host_name),
    host_title: clean(r.host_title),
    host_company: clean(r.host_company),
    company_domain: clean(r.company_domain)?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null,
    // Only accept a LinkedIn URL that really was on the site.
    linkedin_url: li && site.linkedins.includes(normalizeLinkedIn(li) ?? "") ? normalizeLinkedIn(li) : null,
    confidence: r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low",
    bio: clean(r.bio),
    notes: clean(r.notes) ?? "",
  };
}

// ---------- tier 2: web search for LinkedIn ----------

async function webSearch(q: string): Promise<{ url: string; title: string }[]> {
  if (process.env.SERPER_API_KEY) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q, num: 10 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const j = (await res.json()) as { organic?: { link: string; title: string }[] };
    return (j.organic ?? []).map((o) => ({ url: o.link, title: o.title ?? "" }));
  }
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`, {
      headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Brave ${res.status}`);
    const j = (await res.json()) as { web?: { results?: { url: string; title: string }[] } };
    return (j.web?.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "" }));
  }
  return [];
}

function normalizeName(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

async function findLinkedIn(name: string, company: string | null): Promise<string | null> {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const last = normalizeName(parts[parts.length - 1]);
  const first = normalizeName(parts[0]);
  const results = await webSearch(`"${name}" ${company ?? ""} site:linkedin.com/in`.replace(/\s+/g, " ").trim());
  const profiles = results
    .map((r) => ({ url: normalizeLinkedIn(r.url), title: normalizeName(r.title) }))
    .filter((r): r is { url: string; title: string } => !!r.url && r.url.includes("/in/"))
    .filter((r) => r.title.includes(last) && r.title.includes(first));
  if (!profiles.length) return null;
  const co = company ? normalizeName(company) : null;
  return (co && profiles.find((p) => p.title.includes(co))?.url) || profiles[0].url;
}

// ---------- Apollo ----------

interface ApolloPerson {
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  title?: string | null;
  headline?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  organization?: { name?: string | null; primary_domain?: string | null } | null;
}

async function apolloMatch(p: { name: string; company: string | null; domain: string | null; linkedin: string | null }) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;
  const parts = p.name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const body: Record<string, unknown> = {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  if (p.company) body.organization_name = p.company;
  if (p.domain) body.domain = p.domain;
  if (p.linkedin) body.linkedin_url = p.linkedin;
  if (!p.company && !p.domain && !p.linkedin) return null; // a bare name matches the wrong person too often

  const res = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { person?: ApolloPerson | null; error?: string; message?: string };
  if (!res.ok) throw new Error(`Apollo ${res.status}${j.error || j.message ? `: ${j.error ?? j.message}` : ""}`);
  const person = j.person;
  if (!person) return null;
  const email = person.email && !/email_not_unlocked|domain\.com$/i.test(person.email) ? person.email.toLowerCase() : null;
  return {
    email,
    email_status: person.email_status ?? null,
    linkedin: person.linkedin_url ? normalizeLinkedIn(person.linkedin_url) : null,
    title: person.title ?? null,
    company: person.organization?.name ?? null,
    domain: person.organization?.primary_domain ?? null,
    headline: person.headline ?? null,
    location: [person.city, person.state, person.country].filter(Boolean).join(", ") || null,
  };
}

const GENERIC_LOCAL =
  /^(info|hello|hi|contact|podcast|podcasts|pod|show|team|support|admin|media|press|booking|bookings|book|guest|guests|production|producer|producers|office|mail|feedback|listen|studio|inquiries|enquiries)$/i;

export function isGenericEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return GENERIC_LOCAL.test(email.split("@")[0] ?? "");
}

// ---------- main ----------

export async function enrichShow(
  showId: number,
  opts: { useApollo: boolean; ownerName?: string | null },
): Promise<string[]> {
  await ensureEnrichColumns();
  const rows = await db()`select * from shows where id = ${showId}`;
  if (!rows.length) throw new Error("Show not found");
  const show = rows[0] as unknown as Show;
  const log: string[] = [];
  const notes: string[] = [];

  let ownerName = opts.ownerName ?? null;
  if (ownerName === null && show.podcast_index_id) {
    ownerName = (await podcastById(show.podcast_index_id).catch(() => null))?.ownerName ?? null;
  }

  const site = await readWebsite(show.link);
  if (site.homepage) log.push(`read website (${site.linkedins.length} LinkedIn links, ${site.emails.length} emails)`);

  const host = await identifyHost(show, ownerName, site);
  let linkedin = host.linkedin_url;
  let linkedinSource: string | null = linkedin ? "website" : null;
  let title = host.host_title;
  let company = host.host_company;
  let domain = host.company_domain;
  if (host.notes) notes.push(host.notes);

  if (!linkedin && host.host_name && searchProvider()) {
    try {
      linkedin = await findLinkedIn(host.host_name, company);
      if (linkedin) {
        linkedinSource = `search (${searchProvider()})`;
        log.push("found LinkedIn by search");
      }
    } catch (e) {
      notes.push(`LinkedIn search failed: ${(e as Error).message}`);
    }
  }

  const emails: ContactEmail[] = [];
  if (show.host_email) emails.push({ email: show.host_email, source: "rss", status: show.email_status });
  for (const e of site.emails) {
    if (!emails.some((x) => x.email === e.email)) emails.push({ email: e.email, source: "website", url: e.url });
  }

  let location: string | null = null;
  let headline: string | null = null;
  if (opts.useApollo && apolloEnabled() && host.host_name) {
    try {
      const a = await apolloMatch({ name: host.host_name, company, domain, linkedin });
      if (a) {
        if (a.email && !emails.some((x) => x.email === a.email)) {
          emails.push({ email: a.email, source: "apollo", status: a.email_status });
          log.push(`Apollo found ${a.email} (${a.email_status ?? "unverified"})`);
        } else if (!a.email) {
          log.push("Apollo matched the person but had no email");
        }
        if (!linkedin && a.linkedin) {
          linkedin = a.linkedin;
          linkedinSource = "apollo";
        }
        title = title ?? a.title;
        company = company ?? a.company;
        domain = domain ?? a.domain;
        location = a.location;
        headline = a.headline;
      } else {
        log.push("Apollo found no match");
      }
    } catch (e) {
      notes.push(`Apollo: ${(e as Error).message}`);
    }
  }

  // If the feed had no email, use one the show published on its own website (safe to contact).
  let newHostEmail: string | null = null;
  let newEmailStatus: string | null = null;
  if (!show.host_email) {
    const published = site.emails[0]?.email ?? null;
    if (published) {
      newHostEmail = published;
      newEmailStatus = await verifyEmail(published);
      if (newEmailStatus === "invalid") newHostEmail = null;
    }
  }

  await db()`
    update shows set
      host_name = ${host.host_name}, host_title = ${title}, host_company = ${company}, host_domain = ${domain},
      host_linkedin = ${linkedin}, host_linkedin_source = ${linkedinSource}, host_confidence = ${host.confidence},
      host_bio = ${host.bio}, host_location = ${location}, host_headline = ${headline},
      contact_page_url = ${site.contactPage}, guest_form_url = ${site.guestForm},
      contact_emails = ${json(emails)},
      enrich_notes = ${notes.join(" ") || null}, enriched_at = now(),
      host_email = coalesce(host_email, ${newHostEmail}),
      email_status = case when host_email is null and ${newHostEmail}::text is not null then ${newEmailStatus ?? "unknown"} else email_status end,
      status = case when status = 'no_email' and ${newHostEmail}::text is not null then 'new' else status end,
      updated_at = now()
    where id = ${showId}`;

  const summary = [
    host.host_name ? `Host: ${host.host_name}${title ? `, ${title}` : ""}${company ? ` at ${company}` : ""}` : "Host not identified",
    linkedin ? "LinkedIn found" : "no LinkedIn",
    site.guestForm ? "guest form found" : null,
    newHostEmail ? `using website email ${newHostEmail}` : null,
    ...log,
  ]
    .filter(Boolean)
    .join(" · ");
  await logActivity(showId, "enriched", summary.slice(0, 500));
  return [summary];
}
