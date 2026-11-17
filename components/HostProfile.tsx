import type { ReactNode } from "react";
import { fromJson } from "@/lib/db";
import type { ContactEmail } from "@/lib/enrich";

export interface HostProfileData {
  title: string;
  author?: string | null;
  host_name?: string | null;
  host_title?: string | null;
  host_company?: string | null;
  host_domain?: string | null;
  host_linkedin?: string | null;
  host_location?: string | null;
  host_bio?: string | null;
  host_headline?: string | null;
  host_confidence?: string | null;
  host_email?: string | null;
  email_status?: string | null;
  contact_emails?: unknown;
  guest_form_url?: string | null;
  fit_score?: number | null;
  fit_reason?: string | null;
  enriched_at?: Date | string | null;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "good" | "warn" | "muted" | "accent" }) {
  const cls = {
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    muted: "bg-paper text-muted",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.1 9.4h2.4V17H7.1V9.4Zm1.2-3.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM11 9.4h2.3v1h.1c.3-.6 1.1-1.2 2.3-1.2 2.5 0 2.9 1.6 2.9 3.7V17h-2.4v-3.7c0-.9 0-2-1.2-2s-1.4 1-1.4 2V17H11V9.4Z"
      />
    </svg>
  );
}

export function HostProfile({ show, compact = false }: { show: HostProfileData; compact?: boolean }) {
  const contacts = fromJson<ContactEmail[]>(show.contact_emails, []);
  const direct = contacts.filter((c) => c.source === "apollo");
  const directVerified = direct.some((c) => c.status === "verified");
  const primaryVerified = show.email_status === "valid";
  const name = show.host_name ?? null;
  const role = [show.host_title, show.host_company].filter(Boolean).join(" · ");
  const score = show.fit_score ?? null;

  if (!show.enriched_at && !compact) {
    return null;
  }

  return (
    <div className={compact ? "" : "card p-5"}>
      <div className="flex gap-4">
        <div
          className={`flex shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white ${
            compact ? "h-10 w-10 text-sm" : "h-16 w-16 text-xl"
          }`}
        >
          {name ? initials(name) : "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={compact ? "font-medium" : "font-serif text-2xl leading-tight"}>{name ?? "Host not identified"}</span>
            {score != null && <Chip tone={score >= 70 ? "good" : score >= 50 ? "warn" : "muted"}>Match {score}</Chip>}
          </div>
          <div className="mt-0.5 text-sm text-muted">
            {role || (name ? `Host of ${show.title}` : show.author ?? "")}
            {!compact && role ? ` · ${show.title}` : ""}
          </div>
          {show.host_location && <div className="mt-0.5 text-sm text-muted">📍 {show.host_location}</div>}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {show.host_linkedin && (
              <a href={show.host_linkedin} target="_blank" rel="noreferrer" title="LinkedIn profile" className="mr-1">
                <LinkedInIcon />
              </a>
            )}
            {show.host_email && (
              <Chip tone={primaryVerified ? "good" : "muted"}>
                {primaryVerified ? "✓ Verified published email" : "Published email"}
              </Chip>
            )}
            {direct.length > 0 && (
              <Chip tone={directVerified ? "good" : "accent"}>
                {directVerified ? "✓ Verified direct email" : "Direct email found"}
              </Chip>
            )}
            {show.guest_form_url && (
              <a href={show.guest_form_url} target="_blank" rel="noreferrer">
                <Chip tone="good">Guest form ↗</Chip>
              </a>
            )}
            {!compact && show.host_confidence && show.host_confidence !== "high" && (
              <Chip tone="warn">{show.host_confidence} confidence on host</Chip>
            )}
          </div>

          {compact && show.host_bio && <p className="mt-2 line-clamp-2 text-xs text-ink/80">{show.host_bio}</p>}
        </div>
      </div>

      {!compact && (
        <>
          {show.fit_reason && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-accent">Why is this a match?</summary>
              <p className="mt-1 text-ink/80">{show.fit_reason}</p>
            </details>
          )}
          {(show.host_bio || show.host_headline) && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="label">About</div>
              <p className="text-sm leading-relaxed">{show.host_bio ?? show.host_headline}</p>
              {show.host_bio && show.host_headline && <p className="mt-1 text-xs text-muted">LinkedIn headline: {show.host_headline}</p>}
            </div>
          )}
          {show.host_company && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="label">Company</div>
              <p className="text-sm">
                {show.host_company}
                {show.host_domain && (
                  <>
                    {" · "}
                    <a href={`https://${show.host_domain}`} target="_blank" rel="noreferrer" className="text-muted underline">
                      {show.host_domain}
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
