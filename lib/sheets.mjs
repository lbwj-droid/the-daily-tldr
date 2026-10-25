// Minimal Google Sheets REST client shared by the daily job and the Vercel functions.
// Needs two environment variables: SHEET_ID (from the sheet's URL) and GOOGLE_SA_KEY
// (the service account's JSON key, pasted raw or base64-encoded).
import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export const TABS = {
  // One row per link in recent issues. Edit my_headline, status (hide, lead, pin), section, rank, important, for.
  Today: ["date", "id", "section", "rank", "source", "url", "original_headline", "ai_headline", "my_headline", "status", "important", "for", "thumbnail"],
  // Links the editor drops in for the next issue. Blank issue_date = next issue; blank section = Editor's Picks.
  Inbox: ["issue_date", "section", "url", "my_headline", "important", "for", "subscriber", "status"],
  // "Notes from the news desk": one row per issue; blank issue_date = next issue.
  Desk: ["issue_date", "teaser", "url", "status"],
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

const DATE_COLUMNS = new Set(["date", "issue_date"]);

// Cells come back unformatted, so a date the Sheet has turned into a real date cell (shown as 25/10/2026, say)
// arrives as a day number and is converted back to YYYY-MM-DD. Header names are trimmed and lower-cased.
export function normaliseRows(values) {
  const [header = [], ...rows] = values || [];
  const keys = header.map((h) => String(h).trim().toLowerCase());
  const cell = (key, v) => {
    if (v === undefined || v === null) return "";
    if (DATE_COLUMNS.has(key) && typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400e3).toISOString().slice(0, 10);
    return String(v).trim();
  };
  // _row is the sheet row number, so a row can be updated in place later.
  return rows.map((r, n) => ({ ...Object.fromEntries(keys.map((k, i) => [k, cell(k, r[i])])), _row: n + 2 }));
}

export async function readRows(tab) {
  const data = await call(`/values/${enc(`${tab}!A1:Z`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return normaliseRows(data.values);
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

// Column letter for a header in a tab, for single-cell updates.
export function columnOf(tab, header) {
  const i = TABS[tab].indexOf(header);
  if (i < 0) throw new Error(`${tab} has no column ${header}`);
  return String.fromCharCode(65 + i);
}
