// Fetches and normalises RSS, Atom and YouTube channel feeds into one item shape.
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

const UA = "Mozilla/5.0 (compatible; TheDailyTLDR/1.0; +https://github.com/lbwj-droid/the-daily-tldr)";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

export const shortId = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return text(x[0]);
  return text(x["#text"] ?? "");
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "-", mdash: "-" };
export function clean(s, max = 0) {
  let out = String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (max && out.length > max) out = out.slice(0, max - 1).trimEnd() + "…";
  return out;
}

async function get(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", Cookie: "CONSENT=YES+1" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Turns a YouTube handle into its channel ID by reading the channel page once; results are cached.
export async function resolveYoutube(source, cache) {
  if (source.channelId) return `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`;
  if (source.user) return `https://www.youtube.com/feeds/videos.xml?user=${source.user}`;
  // `handles` lists spellings to try in order, for channels that have renamed themselves.
  const handles = (source.handles || [source.handle]).map((h) => h.replace(/^@/, ""));
  const key = handles[0];
  if (!cache[key]) {
    const tried = [];
    for (const h of handles) {
      for (const page of [`https://www.youtube.com/@${h}`, `https://www.youtube.com/c/${h}`]) {
        try {
          const html = await get(page);
          const m =
            html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
            html.match(/"externalId":"(UC[\w-]{22})"/);
          if (m) {
            cache[key] = m[1];
            break;
          }
          tried.push(`${page} (no channel ID)`);
        } catch (err) {
          tried.push(`${page} (${err.message})`);
        }
      }
      if (cache[key]) break;
    }
    if (!cache[key]) throw new Error(`could not find the channel: ${tried.join("; ")}`);
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${cache[key]}`;
}

function imageOf(it) {
  const media = arr(it["media:group"])[0] || it;
  const thumb = arr(media["media:thumbnail"])[0]?.["@_url"];
  if (thumb) return thumb;
  const content = arr(media["media:content"]).find((c) => !c["@_medium"] || c["@_medium"] === "image" || /\.(jpe?g|png|webp)/i.test(c["@_url"] || ""));
  if (content?.["@_url"]) return content["@_url"];
  const enclosure = arr(it.enclosure).find((e) => /^image\//.test(e["@_type"] || ""));
  if (enclosure) return enclosure["@_url"];
  const inline = String(text(it.description) + text(it["content:encoded"])).match(/<img[^>]+src="([^"]+)"/i);
  return inline ? inline[1] : "";
}

function linkOf(it) {
  if (typeof it.link === "string") return it.link.trim();
  const links = arr(it.link);
  const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") || links[0];
  return (alt?.["@_href"] || text(alt) || text(it.guid)).trim();
}

function toIso(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  const raw = doc.rss ? arr(doc.rss.channel?.item) : doc.feed ? arr(doc.feed.entry) : doc["rdf:RDF"] ? arr(doc["rdf:RDF"].item) : [];
  return raw.map((it) => {
    const videoId = text(it["yt:videoId"]);
    const media = arr(it["media:group"])[0] || {};
    const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : linkOf(it);
    const summary = text(media["media:description"]) || text(it.description) || text(it.summary) || text(it["content:encoded"]) || text(it.content);
    return {
      id: shortId(url),
      source: source.name,
      role: source.role,
      tag: source.tag || "",
      lang: source.lang || "",
      kind: videoId ? "video" : "article",
      title: clean(text(it.title), 220),
      summary: clean(summary, 260),
      url,
      published: toIso(text(it.pubDate) || text(it.published) || text(it.updated) || text(it["dc:date"])),
      image: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : imageOf(it),
      isShort: /#shorts?\b/i.test(text(it.title)) || /\/shorts\//.test(url),
    };
  });
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// Fetches every source. Returns the items plus a per-source health report; a failing feed never stops the run.
export async function fetchAll(sources, { ytCache, readFixture, siteSeen = {} } = {}) {
  const health = [];
  const lists = await pool(sources, 8, async (source) => {
    try {
      if (source.kind === "site") {
        const items = await fetchSite(source, siteSeen, readFixture);
        health.push({ source: source.name, ok: true, items: items.length, via: items.via });
        return items;
      }
      let xml;
      if (readFixture) xml = await readFixture(source);
      else {
        const url = source.kind === "youtube" ? await resolveYoutube(source, ytCache) : source.url;
        xml = await get(url);
      }
      const items = parseFeed(xml, source);
      health.push({ source: source.name, ok: true, items: items.length });
      return items;
    } catch (err) {
      health.push({ source: source.name, ok: false, error: String(err.message || err) });
      return [];
    }
  });
  return { items: lists.flat(), health };
}

export async function fetchOgImage(url) {
  try {
    const html = (await get(url, 8000)).slice(0, 200000);
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? new URL(m[1].replace(/&amp;/g, "&"), url).href : "";
  } catch {
    return "";
  }
}

// Title and channel of a YouTube video via its public oEmbed endpoint (used for pinned links).
export async function fetchYoutubeMeta(url) {
  const id = (url.match(/(?:v=|\/live\/|youtu\.be\/|\/shorts\/)([\w-]{11})/) || [])[1];
  if (!id) return null;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  try {
    const meta = JSON.parse(await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, 8000));
    return { url: watch, title: clean(meta.title || ""), source: meta.author_name || "YouTube", image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } catch {
    return { url: watch, title: "", source: "YouTube", image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
}

// Websites without a known feed: use the feed the page advertises if it has one, otherwise read the
// page's article links. A plain link has no date, so it is dated by when the pipeline first saw it
// (kept in config/site-seen.json). Links already there on a site's first visit are back-dated 48 hours,
// which keeps them available to focus sections without flooding the regular page.
async function fetchSite(source, siteSeen, readFixture) {
  const html = readFixture ? await readFixture(source) : await get(source.url);
  const feedUrl = discoverFeed(html, source.url);
  if (feedUrl && !readFixture) {
    try {
      const items = parseFeed(await get(feedUrl), source);
      if (items.length) return Object.assign(items, { via: "feed" });
    } catch {}
  }
  return Object.assign(extractSiteLinks(html, source, siteSeen), { via: "page links" });
}

export function discoverFeed(html, pageUrl) {
  const m = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  const href = m && m[0].match(/href=["']([^"']+)["']/i);
  return href ? new URL(href[1].replace(/&amp;/g, "&"), pageUrl).href : "";
}

const NAV = /\b(login|log in|sign ?up|register|privacy|terms|contact|about us|donate|join us|subscribe|cookie|home|menu|search|read more|click here|share|whatsapp|facebook|instagram|twitter|youtube)\b/i;

export function extractSiteLinks(html, source, siteSeen, now = Date.now()) {
  const page = new URL(source.url);
  const firstVisit = !Object.keys(siteSeen).some((k) => k.startsWith(`${page.hostname}|`));
  const out = [];
  const seenUrls = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), page);
    } catch {
      continue;
    }
    const title = clean(m[2], 220);
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== page.hostname.replace(/^www\./, "")) continue;
    if (url.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "") || url.pathname.split("/").filter(Boolean).length < 1) continue;
    if (title.length < 25 || title.split(" ").length < 4 || NAV.test(title) || /\.(pdf|jpe?g|png|zip)$/i.test(url.pathname)) continue;
    url.hash = "";
    if (seenUrls.has(url.href)) continue;
    seenUrls.add(url.href);
    const key = `${page.hostname}|${url.href}`;
    if (!siteSeen[key]) siteSeen[key] = new Date(firstVisit ? now - 48 * 3600e3 : now).toISOString();
    out.push({
      id: shortId(url.href),
      source: source.name,
      role: source.role,
      tag: source.tag || "",
      lang: source.lang || "",
      kind: "article",
      title,
      summary: "",
      url: url.href,
      published: siteSeen[key],
      image: "",
      isShort: false,
    });
    if (out.length >= 40) break;
  }
  return out;
}

// Drops first-seen records older than 30 days so config/site-seen.json stays small.
export function pruneSiteSeen(siteSeen, now = Date.now()) {
  for (const [k, v] of Object.entries(siteSeen)) if (now - Date.parse(v) > 30 * 86400e3) delete siteSeen[k];
  return siteSeen;
}

export const isHindi = (item) => item.lang === "hi" || /[\u0900-\u097F]/.test(item.title || "");

// Video length in seconds, read from the watch page (YouTube feeds do not carry it). null when unknown.
export async function fetchVideoSeconds(url) {
  try {
    const html = await get(url, 10000);
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// Title, site name and preview image for a link the editor dropped into the Sheet.
export async function fetchPageMeta(url) {
  if (/youtube\.com|youtu\.be/.test(url)) {
    const yt = await fetchYoutubeMeta(url);
    if (yt) return { title: yt.title, source: yt.source, image: yt.image, kind: "video", url: yt.url };
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  try {
    const html = (await get(url, 10000)).slice(0, 300000);
    const meta = (prop) => {
      const m =
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
      return m ? clean(m[1]) : "";
    };
    const title = meta("og:title") || meta("twitter:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const image = meta("og:image") || meta("twitter:image");
    return { title, source: meta("og:site_name") || host, image: image ? new URL(image.replace(/&amp;/g, "&"), url).href : "", kind: "article", url };
  } catch {
    return { title: "", source: host, image: "", kind: "article", url };
  }
}
