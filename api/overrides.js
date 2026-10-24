// GET /api/overrides?date=YYYY-MM-DD
// Returns the editor's changes from the Google Sheet for one edition: rewritten headlines,
// hidden or promoted links, links added by hand, and pinned links. Cached for 5 minutes at the edge.
import { sheetsConfigured, readRows } from "../lib/sheets.mjs";

export default async function handler(req, res) {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  if (!sheetsConfigured()) return res.status(200).json({ configured: false, overrides: {}, added: [], pinned: [] });

  try {
    const all = await readRows("Today");
    const overrides = {};
    const added = [];
    // Pinned rows stay on the page every day, whatever their date, until the status is cleared.
    const pinned = all
      .filter((r) => r.status.trim().toLowerCase() === "pin" && /^https?:\/\//.test(r.url) && (r.my_headline || r.ai_headline))
      .map((r) => ({
        id: r.id || `pin-${r.url}`,
        section: r.section.trim().toLowerCase(),
        headline: r.my_headline || r.ai_headline,
        original_headline: r.original_headline || undefined,
        url: r.url,
        source: r.source || new URL(r.url).hostname.replace(/^www\./, ""),
        pinned: true,
      }));
    for (const r of all.filter((x) => x.date === date)) {
      const status = r.status.trim().toLowerCase();
      if (status === "pin") continue;
      if (!r.ai_headline) {
        // A row the editor typed in: needs at least a link and a headline.
        if (/^https?:\/\//.test(r.url) && r.my_headline && status !== "hide") {
          added.push({
            id: r.id || `add-${added.length + 1}`,
            section: status === "lead" ? "lead" : r.section.trim().toLowerCase(),
            headline: r.my_headline,
            url: r.url,
            source: r.source || new URL(r.url).hostname.replace(/^www\./, ""),
            thumbnail: r.thumbnail || undefined,
          });
        }
      } else if (r.my_headline || status) {
        overrides[r.id] = { headline: r.my_headline || undefined, status: status || undefined };
      }
    }
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ configured: true, overrides, added, pinned });
  } catch (err) {
    console.error(err);
    return res.status(200).json({ configured: true, error: "sheet unavailable", overrides: {}, added: [], pinned: [] });
  }
}
