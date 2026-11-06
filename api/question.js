// POST /api/question  {r, date, section, headline, url, question}
// A reader's question about one link, from the "?" button under it. Appends one row to the Questions tab; the editor
// answers one per issue (a Desk note or a link) and marks the row's status.
import { sheetsConfigured, appendRows, ensureTabs, toRow, TABS } from "../lib/sheets.mjs";

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Returns the row to store, or null when the request is not a usable question.
export function questionRow(body, now = new Date()) {
  const question = clip(body?.question, 500);
  const url = clip(body?.url, 500);
  if (question.length < 2 || !/^https?:\/\//.test(url)) return null;
  return {
    timestamp: now.toISOString(),
    reader: clip(body.r, 24).toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown",
    date: /^\d{4}-\d{2}-\d{2}$/.test(clip(body.date, 10)) ? clip(body.date, 10) : "",
    section: clip(body.section, 20),
    headline: clip(body.headline, 200),
    url,
    // A leading = + - @ would make the Sheet treat the cell as a formula; RAW input already prevents that, and the
    // apostrophe keeps it visible as text if the tab is ever pasted elsewhere.
    question: /^[=+\-@]/.test(question) ? `'${question}` : question,
    status: "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false });
    }
  }
  const row = questionRow(body);
  if (!row) return res.status(400).json({ ok: false });
  if (!sheetsConfigured()) return res.status(200).json({ ok: true, stored: false });
  try {
    await appendRows("Questions", [toRow("Questions", row)]);
  } catch (err) {
    // The tab is created by each build; if a question arrives first, create it here and try once more.
    try {
      await ensureTabs({ Questions: TABS.Questions });
      await appendRows("Questions", [toRow("Questions", row)]);
    } catch (err2) {
      console.error(err, err2);
      return res.status(502).json({ ok: false });
    }
  }
  return res.status(200).json({ ok: true, stored: true });
}
