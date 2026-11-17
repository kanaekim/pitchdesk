// Single-password gate. The session cookie holds a SHA-256 of the password,
// computed with Web Crypto so it works in both middleware (edge) and Node.
export const SESSION_COOKIE = "pd_session";

export async function sessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const data = new TextEncoder().encode(`pitchdesk:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
