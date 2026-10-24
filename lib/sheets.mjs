// Minimal Google Sheets REST client shared by the daily job and the Vercel functions.
// Needs two environment variables: SHEET_ID (from the sheet's URL) and GOOGLE_SA_KEY
// (the service account's JSON key, pasted raw or base64-encoded).
import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export const TABS = {
  Today: ["date", "id", "section", "rank", "source", "url", "original_headline", "ai_headline", "my_headline", "status", "thumbnail"],
  Style: ["date", "id", "original_headline", "ai_headline", "my_headline"],
  Clicks: ["timestamp", "reader", "date", "section", "headline", "url"],
};

export function sheetsConfigured() {
  return Boolean(process.env.SHEET_ID && process.env.GOOGLE_SA_KEY);
}

function parseKey(raw) {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(text);
  return { email: key.client_email, key: key.private_key };
}

let cachedJwt;
async function authHeader() {
  if (!cachedJwt) {
    const { email, key } = parseKey(process.env.GOOGLE_SA_KEY);
    cachedJwt = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  }
  const { token } = await cachedJwt.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}/${process.env.SHEET_ID}${path}`, {
    method,
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Sheets ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const enc = (range) => encodeURIComponent(range);

// Creates any missing tabs and writes their header rows.
export async function ensureTabs(tabs = TABS) {
  const meta = await call("?fields=sheets.properties.title");
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = Object.keys(tabs).filter((t) => !have.has(t));
  if (missing.length) {
    await call(":batchUpdate", {
      method: "POST",
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
  }
  for (const t of missing) await writeRows(`${t}!A1`, [tabs[t]]);
}

export async function readRows(tab) {
  const data = await call(`/values/${enc(`${tab}!A1:Z`)}`);
  const [header = [], ...rows] = data.values || [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export async function writeRows(range, rows) {
  return call(`/values/${enc(range)}?valueInputOption=RAW`, { method: "PUT", body: { values: rows } });
}

export async function clearTab(tab) {
  return call(`/values/${enc(`${tab}!A2:Z`)}:clear`, { method: "POST", body: {} });
}

export async function appendRows(tab, rows) {
  return call(`/values/${enc(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: { values: rows },
  });
}

export function toRow(tab, obj) {
  return TABS[tab].map((h) => (obj[h] ?? "").toString());
}
