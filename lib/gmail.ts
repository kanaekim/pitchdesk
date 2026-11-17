import { db } from "./db";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function redirectUri() {
  return `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/gmail/callback`;
}

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      ...params,
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export async function connectWithCode(code: string) {
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tok.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  const profileRes = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const profile = (await profileRes.json()) as { emailAddress?: string };
  if (!profile.emailAddress) throw new Error("Could not read the Gmail address.");
  const expires = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await db()`
    insert into gmail_account (id, email, refresh_token, access_token, expires_at, connected_at)
    values (1, ${profile.emailAddress}, ${tok.refresh_token}, ${tok.access_token}, ${expires}, now())
    on conflict (id) do update set email = excluded.email, refresh_token = excluded.refresh_token,
      access_token = excluded.access_token, expires_at = excluded.expires_at, connected_at = now()`;
  return profile.emailAddress;
}

export async function gmailAccount(): Promise<{ email: string } | null> {
  const rows = await db()`select email from gmail_account where id = 1`;
  return rows.length ? { email: rows[0].email as string } : null;
}

export async function disconnectGmail() {
  await db()`delete from gmail_account where id = 1`;
}

async function accessToken(): Promise<{ token: string; email: string }> {
  const rows = await db()`select * from gmail_account where id = 1`;
  if (!rows.length) throw new Error("Gmail is not connected.");
  const acct = rows[0];
  if (acct.access_token && acct.expires_at && new Date(acct.expires_at).getTime() > Date.now()) {
    return { token: acct.access_token as string, email: acct.email as string };
  }
  const tok = await tokenRequest({ refresh_token: acct.refresh_token as string, grant_type: "refresh_token" });
  const expires = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await db()`update gmail_account set access_token = ${tok.access_token}, expires_at = ${expires} where id = 1`;
  return { token: tok.access_token, email: acct.email as string };
}

async function gmailFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function encodeHeader(value: string) {
  // RFC 2047 encode only when needed so plain subjects stay plain.
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRaw(opts: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
}) {
  const headers = [
    `From: ${encodeHeader(opts.fromName)} <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`);
  }
  const raw = `${headers.join("\r\n")}\r\n\r\n${opts.body.replace(/\r?\n/g, "\r\n")}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function emailOf(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

export function plainBody(msg: GmailMessage): string {
  const walk = (p?: GmailPart): string | null => {
    if (!p) return null;
    if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
    for (const c of p.parts ?? []) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  const text = walk(msg.payload);
  if (text) return text;
  const htmlWalk = (p?: GmailPart): string | null => {
    if (!p) return null;
    if (p.mimeType === "text/html" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
    for (const c of p.parts ?? []) {
      const r = htmlWalk(c);
      if (r) return r;
    }
    return null;
  };
  const html = htmlWalk(msg.payload);
  if (html) return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return msg.snippet ?? "";
}

// Strip quoted history so the classifier sees only the new reply.
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line)) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function sendEmail(opts: {
  to: string;
  fromName: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
}) {
  const { email } = await accessToken();
  const raw = buildRaw({ from: email, ...opts });
  const sent = await gmailFetch<{ id: string; threadId: string }>(`/messages/send`, {
    method: "POST",
    body: JSON.stringify(opts.threadId ? { raw, threadId: opts.threadId } : { raw }),
  });
  // Read back the RFC Message-ID so follow-ups can thread correctly in the host's client.
  const meta = await gmailFetch<GmailMessage>(`/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
  return { id: sent.id, threadId: sent.threadId, rfcMessageId: header(meta, "Message-ID") || null };
}

export async function getThread(threadId: string) {
  return gmailFetch<{ id: string; messages: GmailMessage[] }>(`/threads/${threadId}?format=full`);
}

export async function createDraftReply(opts: {
  to: string;
  fromName: string;
  subject: string;
  body: string;
  threadId: string;
  inReplyTo?: string | null;
}) {
  const { email } = await accessToken();
  const raw = buildRaw({ from: email, ...opts });
  return gmailFetch<{ id: string }>(`/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw, threadId: opts.threadId } }),
  });
}

export async function senderEmail(): Promise<string | null> {
  return (await gmailAccount())?.email ?? null;
}
