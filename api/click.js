// POST /api/click  {r, date, section, headline, url}
// Appends one row to the Clicks tab. Sent with navigator.sendBeacon, so the reader is never kept waiting.
import { sheetsConfigured, appendRows, toRow } from "../lib/sheets.mjs";

const clip = (v, n) => String(v ?? "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!sheetsConfigured()) return res.status(204).end();
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).end();
    }
  }
  const url = clip(body?.url, 500);
  if (!/^https?:\/\//.test(url)) return res.status(400).end();
  const reader = clip(body?.r, 24).toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown";
  try {
    await appendRows("Clicks", [
      toRow("Clicks", {
        timestamp: new Date().toISOString(),
        reader,
        date: clip(body.date, 10),
        section: clip(body.section, 20),
        headline: clip(body.headline, 200),
        url,
      }),
    ]);
  } catch (err) {
    console.error(err);
  }
  return res.status(204).end();
}
