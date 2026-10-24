import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeed, clean } from "../scripts/lib/feeds.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = { name: "Test", role: "prefer" };

test("parses RSS with CDATA, entities and media thumbnails", () => {
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title><![CDATA[Tom &amp; Jerry&#39;s <b>big</b> day]]></title>
    <link>https://example.org/a</link><description>&lt;p&gt;Hello&nbsp;world&lt;/p&gt;</description>
    <pubDate>Sat, 24 Oct 2026 01:00:00 GMT</pubDate><media:thumbnail url="https://example.org/a.jpg"/></item></channel></rss>`;
  const [item] = parseFeed(xml, src);
  assert.equal(item.title, "Tom & Jerry's big day");
  assert.equal(item.url, "https://example.org/a");
  assert.equal(item.image, "https://example.org/a.jpg");
  assert.equal(item.published, "2026-10-24T01:00:00.000Z");
  assert.equal(item.kind, "article");
});

test("parses YouTube Atom into video items with thumbnails and flags Shorts", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Big explainer</title><published>2026-10-24T02:00:00+00:00</published>
    <media:group><media:description>What happened</media:description></media:group></entry>
    <entry><yt:videoId>zzzzzzzzzzz</yt:videoId><title>Quick take #shorts</title><published>2026-10-24T03:00:00+00:00</published></entry></feed>`;
  const [video, short] = parseFeed(xml, src);
  assert.equal(video.url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(video.image, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  assert.equal(video.kind, "video");
  assert.equal(video.summary, "What happened");
  assert.equal(short.isShort, true);
});

test("a bad date does not crash parsing", () => {
  const [item] = parseFeed(`<rss><channel><item><title>x</title><link>https://e.org/x</link><pubDate>not a date</pubDate></item></channel></rss>`, src);
  assert.equal(item.published, "");
});

test("clean() strips tags and truncates", () => {
  assert.equal(clean("<p>a  b</p>", 0), "a b");
  assert.equal(clean("abcdefghij", 5), "abcd…");
});

test("dry run builds a valid edition from fixtures", () => {
  execFileSync("node", [path.join(root, "test", "make-fixtures.mjs")]);
  const out = mkdtempSync(path.join(tmpdir(), "tldr-"));
  execFileSync("node", [path.join(root, "scripts", "build-edition.mjs"), "--dry-run", "--out", out]);
  const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8"));
  const [file] = readdirSync(path.join(out, "editions"));
  const edition = JSON.parse(readFileSync(path.join(out, "editions", file), "utf8"));
  const settings = JSON.parse(readFileSync(path.join(root, "config", "settings.json"), "utf8"));
  assert.equal(index.latest, edition.date);
  assert.ok(edition.lead?.url.startsWith("https://"));
  assert.deepEqual(edition.sections.map((s) => s.key), settings.sections.map((s) => s.key));
  const ids = [edition.lead, ...edition.sections.flatMap((s) => s.items)].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "no story appears twice");
  for (const s of edition.sections) {
    const quota = settings.sections.find((x) => x.key === s.key).quota;
    assert.ok(s.items.length <= quota, `${s.key} within quota`);
  }
});
