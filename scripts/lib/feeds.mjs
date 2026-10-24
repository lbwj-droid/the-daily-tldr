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
  const handle = source.handle.replace(/^@/, "");
  if (!cache[handle]) {
    const html = await get(`https://www.youtube.com/@${handle}`);
    const m =
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
      html.match(/"externalId":"(UC[\w-]{22})"/);
    if (!m) throw new Error(`could not find a channel ID for @${handle}`);
    cache[handle] = m[1];
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${cache[handle]}`;
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
export async function fetchAll(sources, { ytCache, readFixture } = {}) {
  const health = [];
  const lists = await pool(sources, 8, async (source) => {
    try {
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
