// Files the editor drops into the shared "TL;DR uploads" Google Drive folder: images are served through /api/media and
// Google Docs become pages at /p/<id>. Only files inside that folder (or folders within it) are ever served, and only
// images and Docs. Uses the same service account as the Sheet, with read-only Drive access.
import { authHeader } from "./sheets.mjs";

const API = "https://www.googleapis.com/drive/v3/files";
export const DOC = "application/vnd.google-apps.document";
// The "TL;DR uploads" folder, shared with the service account as Viewer.
export const FOLDER = "16dlAPrON7I_uVI6E3UeFOiegLXbXnfxZ";

// The file id in a Drive or Docs link (share links, open?id=, uc?id=, docs.google.com/document/d/...), or "".
export function driveFileId(link) {
  let u;
  try {
    u = new URL(String(link || "").trim());
  } catch {
    return "";
  }
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) return "";
  const m = u.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([\w-]{20,})/);
  const id = m ? m[1] : u.searchParams.get("id") || "";
  return /^[\w-]{20,}$/.test(id) ? id : "";
}

export const isDocLink = (link) => /docs\.google\.com\/document\//.test(String(link || "")) && Boolean(driveFileId(link));

async function drive(path, { raw = false } = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { headers: await authHeader() });
  if (!res.ok) throw Object.assign(new Error(`Drive ${res.status}`), { status: res.status });
  return raw ? res : res.json();
}

// Metadata of a file, or null when it is not inside the uploads folder (or cannot be read at all).
export async function fileInFolder(id, folder = FOLDER) {
  if (!/^[\w-]{20,}$/.test(id || "")) return null;
  let meta;
  try {
    meta = await drive(`/${id}?fields=id,name,mimeType,parents,size,modifiedTime,thumbnailLink&supportsAllDrives=true`);
  } catch {
    return null;
  }
  let parents = meta.parents || [];
  for (let depth = 0; depth < 6 && parents.length; depth++) {
    if (parents.includes(folder)) return meta;
    try {
      parents = (await drive(`/${parents[0]}?fields=parents&supportsAllDrives=true`)).parents || [];
    } catch {
      return null;
    }
  }
  return null;
}

// The image bytes: Drive's resized copy (about 1600px wide, small enough for a phone) when there is one, else the
// original if it is under 4 MB.
export async function imageBytes(meta) {
  if (meta.thumbnailLink) {
    try {
      const res = await drive(meta.thumbnailLink.replace(/=s\d+$/, "=s1600"), { raw: true });
      return { type: res.headers.get("content-type") || "image/jpeg", body: Buffer.from(await res.arrayBuffer()) };
    } catch {}
  }
  if (Number(meta.size || 0) > 4e6) return null;
  const res = await drive(`/${meta.id}?alt=media&supportsAllDrives=true`, { raw: true });
  return { type: meta.mimeType, body: Buffer.from(await res.arrayBuffer()) };
}

export async function docHtml(id) {
  const res = await drive(`/${id}/export?mimeType=text%2Fhtml`, { raw: true });
  return res.text();
}

const ALLOWED = new Set(["h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "a", "strong", "b", "em", "i", "u", "br", "hr", "blockquote", "img", "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"]);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Google's exported HTML, reduced to plain tags: no styles, classes or scripts. Google's redirect links are unwrapped,
// and bold/italic spans become <b>/<i>.
export function cleanDocHtml(html) {
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  body = body.replace(/<(script|style|head|title|meta|link)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  body = body.replace(/<span[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi, (m, style, inner) => {
    let out = inner;
    if (/font-style:\s*italic/.test(style)) out = `<i>${out}</i>`;
    if (/font-weight:\s*(700|bold)/.test(style)) out = `<b>${out}</b>`;
    return out;
  });
  return body
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, name, attrs) => {
      const n = name.toLowerCase();
      if (!ALLOWED.has(n)) return "";
      if (tag.startsWith("</")) return `</${n}>`;
      if (n === "a") {
        let href = (attrs.match(/href="([^"]*)"/i) || [])[1] || "";
        href = href.replace(/&amp;/g, "&");
        try {
          const u = new URL(href);
          if (u.hostname === "www.google.com" && u.pathname === "/url" && u.searchParams.get("q")) href = u.searchParams.get("q");
        } catch {
          return "<a>";
        }
        return /^https?:\/\//.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">` : "<a>";
      }
      if (n === "img") {
        const src = ((attrs.match(/src="([^"]*)"/i) || [])[1] || "").replace(/&amp;/g, "&");
        return /^https:\/\//.test(src) ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
      }
      return `<${n}>`;
    })
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function docPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · The Daily TL;DR</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="masthead"><p class="brand"><a href="/">THE DAILY TL;DR</a></p></header>
<main class="docpage">
<p class="back"><a href="/">&larr; Back to the issue</a></p>
<h1>${esc(title)}</h1>
<article>${bodyHtml}</article>
<p class="back"><a href="/">&larr; Back to the issue</a></p>
</main>
</body>
</html>`;
}
