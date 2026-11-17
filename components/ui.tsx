import Link from "next/link";
import type { ReactNode } from "react";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-paper text-muted",
  no_email: "bg-paper text-muted",
  drafted: "bg-warn-soft text-warn",
  approved: "bg-accent-soft text-accent",
  contacted: "bg-accent-soft text-accent",
  replied: "bg-good-soft text-good",
  booked: "bg-good text-white",
  declined: "bg-bad-soft text-bad",
  no_response: "bg-paper text-muted",
  bounced: "bg-bad-soft text-bad",
  skipped: "bg-paper text-muted",
  positive: "bg-good-soft text-good",
  question: "bg-warn-soft text-warn",
  negative: "bg-bad-soft text-bad",
  out_of_office: "bg-paper text-muted",
  other: "bg-paper text-muted",
  bounce: "bg-bad-soft text-bad",
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[value] ?? "bg-paper text-muted"}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function FitScore({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  const tone = score >= 80 ? "text-good" : score >= 60 ? "text-warn" : "text-bad";
  return <span className={`font-mono text-sm font-semibold ${tone}`}>{score}</span>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Flash({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div className="mb-5 rounded-lg border border-line bg-white px-4 py-3 text-sm">{msg}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card px-6 py-12 text-center text-sm text-muted">{children}</div>;
}

export function ShowLink({ id, title }: { id: number; title: string }) {
  return (
    <Link href={`/shows/${id}`} className="font-medium hover:underline">
      {title}
    </Link>
  );
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtRelative(d: Date | string | null | undefined) {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}
