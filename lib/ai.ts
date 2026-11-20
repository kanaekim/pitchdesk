import type { Episode, Settings, Show } from "./db";

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export async function claude(system: string, user: string, maxTokens = 1200): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Claude API: ${json.error?.message ?? res.status}`);
  return (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/**
 * Anthropic's structured-output schemas want every object closed
 * (additionalProperties: false) and prefer anyOf over type arrays like
 * ["string","null"]. Normalise so call sites can write simple schemas.
 */
function normalizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = normalizeSchema(v);
  if (Array.isArray(src.type)) {
    const { type: types, ...rest } = out as { type: string[] } & Record<string, unknown>;
    return { ...rest, anyOf: types.map((t) => ({ type: t })) };
  }
  if (out.type === "object" && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

type MessagesResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
};

async function callMessages(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: MessagesResponse }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: (await res.json()) as MessagesResponse };
}

/**
 * Ask Claude for structured JSON. Uses native structured outputs
 * (output_config.format = json_schema), which newer models support in place of
 * forced tool_choice. If the API rejects that request, retries once with a plain
 * "reply with JSON only" prompt and parses the text.
 */
export async function claudeJson<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxTokens = 1200,
): Promise<T> {
  const textOf = (j: MessagesResponse) =>
    (j.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

  const first = await callMessages({
    model: MODEL(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: normalizeSchema(schema) } },
  });

  let json = first.json;
  if (!first.ok) {
    // Fallback: no native structured output for this request. Ask in plain words instead.
    const retry = await callMessages({
      model: MODEL(),
      max_tokens: maxTokens,
      system: `${system}\n\nReply with ONLY a single JSON object that matches this JSON Schema. No prose, no markdown fences.\n${JSON.stringify(schema)}`,
      messages: [{ role: "user", content: user }],
    });
    if (!retry.ok) {
      throw new Error(`Claude API: ${retry.json.error?.message ?? first.json.error?.message ?? retry.status}`);
    }
    json = retry.json;
  }

  if (json.stop_reason === "max_tokens") {
    throw new Error("Claude's answer was cut off (max_tokens). Try again.");
  }
  const text = textOf(json).trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    return parseJson<T>(text);
  }
}

function profileBlock(s: Settings) {
  return `GUEST: ${s.guest_name}

OFFER / WHO THE GUEST IS:
${s.offer}

PROOF (only use these facts, never invent numbers):
${s.proof}

EPISODE TOPICS:
${s.topics}

THE ASK:
${s.ask}

VOICE:
${s.voice}`;
}

function episodesBlock(eps: Episode[]) {
  if (!eps.length) return "No recent episodes available.";
  return eps
    .map((e, i) => `${i + 1}. "${e.title}"${e.date ? ` (${e.date.slice(0, 10)})` : ""}\n   ${e.description.slice(0, 400)}`)
    .join("\n");
}

function showBlock(show: Show) {
  return `PODCAST: ${show.title}
HOST: ${show.host_name ? `${show.host_name}${show.host_title ? `, ${show.host_title}` : ""}${show.host_company ? ` at ${show.host_company}` : ""}` : "unknown"}
FEED AUTHOR: ${show.author ?? "unknown"}
CATEGORIES: ${show.categories ?? ""}
DESCRIPTION: ${(show.description ?? "").slice(0, 1200)}
RECENT EPISODES:
${episodesBlock(show.latest_episodes ?? [])}`;
}

export async function scoreFit(s: Settings, show: Show): Promise<{ score: number; reason: string }> {
  const r = await claudeJson<{ score: number; reason: string }>(
    `You qualify podcasts for a guest booking campaign. Be strict. A good fit has an audience of CEOs, founders, executives, board members or business owners, regularly interviews outside guests, and would plausibly book this guest. Shows that are solo-host only, hobby, entertainment, or unrelated niches score low. Give a score from 0 to 100 and a one-sentence reason.`,
    `${profileBlock(s)}\n\n---\n\n${showBlock(show)}`,
    {
      type: "object",
      properties: { score: { type: "number" }, reason: { type: "string" } },
      required: ["score", "reason"],
    },
    400,
  );
  return { score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), reason: String(r.reason ?? "") };
}

export async function draftPitch(
  s: Settings,
  show: Show,
): Promise<{ subject: string; body: string; episode_ref: string | null }> {
  const subjects = s.subject_lines.length ? s.subject_lines.map((x) => `- ${x}`).join("\n") : "(none provided)";
  const r = await claudeJson<{ subject: string; body: string; episode_ref: string | null }>(
    `You write cold guest pitches to podcast hosts on behalf of the guest, in the guest's own first-person voice. The email is sent from the guest's personal inbox, so it must read like the guest wrote it to one host.

Rules:
- 80 to 130 words in the body. Plain text. No bullet points, no links, no bold, no emojis.
- Open with the host's show, not with the guest. If a recent episode is relevant, reference it by its real title and what it was about, based only on the description given. Never claim to have listened ("I loved", "I just listened"). Say things like "your episode on X" instead.
- Connect that episode or the show's focus to one specific topic the guest can cover.
- Use one or two proof points from the PROOF list. Never invent facts or numbers.
- End with the ask exactly as described. Reply only. No calendar link, no "hop on a call".
- Match the VOICE. No flattery, no "I hope this email finds you well", no "I'd love to".
- Subject: pick the best fit from the subject line list, or write one in the same style (lowercase, under 8 words). Replace {{podcast}} with the show name.
- Do not include a signature; it is added automatically.
- If the HOST name is known, greet them by first name ("Hi Rachel,"). Otherwise use the first name from FEED AUTHOR only if it is clearly a person. Otherwise use "Hi there,".

Return subject, body, and episode_ref (the exact episode title you referenced, or null).`,
    `${profileBlock(s)}\n\nSUBJECT LINES TO CHOOSE FROM:\n${subjects}\n\n---\n\n${showBlock(show)}`,
    {
      type: "object",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
        episode_ref: { type: ["string", "null"] },
      },
      required: ["subject", "body", "episode_ref"],
    },
    1500,
  );
  return {
    subject: String(r.subject ?? "").replace(/\{\{podcast\}\}/gi, show.title),
    body: String(r.body ?? "").trim(),
    episode_ref: r.episode_ref ? String(r.episode_ref) : null,
  };
}

export async function draftFollowup(s: Settings, show: Show, original: string, step: number): Promise<string> {
  const text = await claude(
    `You write a short follow-up to a podcast guest pitch that got no reply. It is sent as a reply in the same email thread, in the guest's first-person voice.
Rules: ${step === 1 ? "25 to 50 words. Add one new, specific angle or proof point not in the original." : "15 to 35 words. A polite last note that closes the loop and makes it easy to say no."}
Plain text, no links, no signature, no guilt-tripping, no "just bumping this", no "circling back". Match the VOICE. Return only the body text.`,
    `${profileBlock(s)}\n\n---\n\n${showBlock(show)}\n\n---\n\nORIGINAL PITCH:\n${original}`,
    400,
  );
  return text.trim().replace(/^"|"$/g, "");
}

export async function classifyReply(
  s: Settings,
  show: Show,
  pitch: string,
  reply: string,
): Promise<{ classification: "positive" | "question" | "negative" | "out_of_office" | "other"; suggested_reply: string }> {
  const r = await claudeJson<{ classification: string; suggested_reply: string }>(
    `You triage replies from podcast hosts to a guest pitch, and draft the guest's response in the guest's voice.
Classify as one of: "positive" (wants to book or asks for dates/topics), "question" (needs info before deciding, or redirects to a form/producer), "negative" (no, not a fit, pay-to-play offer), "out_of_office" (auto-reply), "other".
For positive or question replies, write a short reply (40 to 100 words) from the guest that answers directly and moves toward a recording date. Offer topics from the list if useful. Do not invent availability; say "I'll send a few times" if dates are needed. For negative, write a gracious one or two line thank-you. For out_of_office, leave suggested_reply empty.`,
    `${profileBlock(s)}\n\n---\n\nPODCAST: ${show.title}\n\nOUR PITCH:\n${pitch}\n\nTHEIR REPLY:\n${reply.slice(0, 4000)}`,
    {
      type: "object",
      properties: {
        classification: { type: "string", enum: ["positive", "question", "negative", "out_of_office", "other"] },
        suggested_reply: { type: "string" },
      },
      required: ["classification", "suggested_reply"],
    },
    1000,
  );
  const allowed = ["positive", "question", "negative", "out_of_office", "other"] as const;
  const c = (allowed as readonly string[]).includes(r.classification) ? (r.classification as (typeof allowed)[number]) : "other";
  return { classification: c, suggested_reply: String(r.suggested_reply ?? "") };
}
