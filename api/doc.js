// GET /p/<Google Doc id> (rewritten to /api/doc?id=...)
// Shows a Google Doc from the editor's "TL;DR uploads" Drive folder as a page on the site, in the site's style.
// Edits to the Doc show within about a minute.
import { sheetsConfigured } from "../lib/sheets.mjs";
import { DOC, fileInFolder, docHtml, cleanDocHtml, docPage } from "../lib/drive.mjs";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const missing = docPage("Not found", "<p>This page is not available.</p>");
  if (!sheetsConfigured()) return res.status(404).send(missing);
  const meta = await fileInFolder(String(req.query.id || ""));
  // A Doc outside the uploads folder (an older Desk note shared "anyone with the link", say) opens on Google Docs.
  if (!meta && /^[\w-]{20,}$/.test(String(req.query.id || ""))) return res.redirect(302, `https://docs.google.com/document/d/${req.query.id}/view`);
  if (!meta || meta.mimeType !== DOC) return res.status(404).send(missing);
  try {
    const body = cleanDocHtml(await docHtml(meta.id));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(docPage(meta.name, body));
  } catch (err) {
    console.error(err);
    return res.status(502).send(docPage("Try again shortly", "<p>This page could not be loaded just now.</p>"));
  }
}
