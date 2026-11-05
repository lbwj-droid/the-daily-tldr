// GET /api/media?id=<Drive file id>
// Serves an image from the editor's "TL;DR uploads" Drive folder, so a Drive share link can be used as a thumbnail.
// Add &debug=1 to see each step and where it stopped.
import { sheetsConfigured } from "../lib/sheets.mjs";
import { fileInFolder, imageBytes, explainFile } from "../lib/drive.mjs";

export default async function handler(req, res) {
  if (!sheetsConfigured()) return res.status(404).end();
  // ?debug=1 explains why an image does not show.
  if (req.query.debug) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(await explainFile(String(req.query.id || "")));
  }
  const meta = await fileInFolder(String(req.query.id || ""));
  if (!meta || !/^image\//.test(meta.mimeType)) return res.status(404).end();
  try {
    const img = await imageBytes(meta);
    if (!img) return res.status(413).end();
    res.setHeader("Content-Type", img.type);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(img.body);
  } catch (err) {
    console.error(err);
    return res.status(502).end();
  }
}
