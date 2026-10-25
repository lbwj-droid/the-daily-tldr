// GET /api/overrides?date=YYYY-MM-DD
// Returns the editor's live changes from the Google Sheet for one issue: every Today row for that date (headline,
// status, section, rank, important, for), pinned rows from any date, and the Desk note. The page applies them on top of
// the published issue. Cached for about a minute at the edge.
import { sheetsConfigured, readRows } from "../lib/sheets.mjs";

const EMPTY = { rows: [], pinned: [], desk: null };
const clean = (v) => String(v ?? "").trim();

export default async function handler(req, res) {
  const date = clean(req.query.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  if (!sheetsConfigured()) return res.status(200).json({ configured: false, ...EMPTY });

  try {
    const [today, desk] = await Promise.all([readRows("Today"), readRows("Desk").catch(() => [])]);
    const rows = today
      .filter((r) => r.date === date && clean(r.status).toLowerCase() !== "pin")
      .map((r) => ({
        id: clean(r.id),
        url: clean(r.url),
        section: clean(r.section).toLowerCase(),
        rank: clean(r.rank),
        source: clean(r.source),
        my_headline: clean(r.my_headline),
        status: clean(r.status).toLowerCase(),
        important: clean(r.important),
        for: clean(r.for),
      }));
    // Pinned rows stay on the page in every issue, whatever their date, until the status is cleared.
    const pinned = today
      .filter((r) => clean(r.status).toLowerCase() === "pin" && /^https?:\/\//.test(clean(r.url)) && (r.my_headline || r.ai_headline))
      .map((r) => ({
        id: clean(r.id) || `pin-${clean(r.url)}`,
        section: clean(r.section).toLowerCase(),
        headline: clean(r.my_headline) || clean(r.ai_headline),
        original_headline: clean(r.original_headline) || undefined,
        url: clean(r.url),
        source: clean(r.source) || new URL(clean(r.url)).hostname.replace(/^www\./, ""),
        pinned: true,
      }));
    const note = desk.find((r) => r.issue_date === date && /^https?:\/\//.test(clean(r.url)));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({ configured: true, rows, pinned, desk: note ? { teaser: clean(note.teaser), url: clean(note.url) } : null });
  } catch (err) {
    console.error(err);
    return res.status(200).json({ configured: true, error: "sheet unavailable", ...EMPTY });
  }
}
