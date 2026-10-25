import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeed, clean, extractSiteLinks, discoverFeed } from "../scripts/lib/feeds.mjs";
import { normaliseRows } from "../lib/sheets.mjs";

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

const settings = JSON.parse(readFileSync(path.join(root, "config", "settings.json"), "utf8"));
const allItems = (e) => [e.lead, ...e.sections.flatMap((s) => s.items)].filter(Boolean);
const isHindiTitle = (i) => /[\u0900-\u097F]/.test(i.original_headline || i.headline);

function dryRun({ date = "2026-10-30", inbox, focus, out = mkdtempSync(path.join(tmpdir(), "tldr-")) } = {}) {
  execFileSync("node", [path.join(root, "test", "make-fixtures.mjs")]);
  const extra = [];
  if (inbox) {
    writeFileSync(path.join(out, "inbox.json"), JSON.stringify(inbox));
    extra.push("--inbox", path.join(out, "inbox.json"));
  }
  if (focus) {
    writeFileSync(path.join(out, "focus.json"), JSON.stringify(focus));
    extra.push("--focus", path.join(out, "focus.json"));
  }
  execFileSync("node", [path.join(root, "scripts", "build-edition.mjs"), "--dry-run", "--out", out, ...extra], { env: { ...process.env, EDITION_DATE: date } });
  return {
    out,
    edition: JSON.parse(readFileSync(path.join(out, "editions", `${date}.json`), "utf8")),
    index: JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")),
  };
}

test("an issue never exceeds the link limit, repeats nothing and keeps Hindi within its cap", () => {
  const { edition, index } = dryRun();
  const items = allItems(edition);
  assert.ok(edition.lead?.url.startsWith("https://"));
  assert.ok(items.length <= settings.maxLinks, `${items.length} links`);
  assert.equal(new Set(items.map((i) => i.url)).size, items.length, "no link appears twice");
  assert.ok(items.filter(isHindiTitle).length <= settings.hindiMax, "Hindi cap");
  assert.equal(edition.publish_at, "2026-10-30T03:30:00.000Z", "released 07:30 Dubai");
  assert.equal(index.editions[0].publish_at, edition.publish_at);
  assert.equal(edition.issue, 1);
  for (const s of edition.sections.filter((x) => !x.focus)) {
    assert.ok(s.items.length <= settings.sections.find((x) => x.key === s.key).max, `${s.key} within its max`);
  }
});

test("the editor's Inbox links fill Editor's Picks, can set the lead, and squeeze Claude's share", () => {
  const inbox = {
    inbox: [
      { url: "https://news.example.com/a", my_headline: "Pick A", subscriber: "yes" },
      { section: "picks", url: "https://news.example.com/b", my_headline: "Pick B", important: "yes" },
      { section: "picks", url: "https://news.example.com/c", my_headline: "Pick C", for: "Asha" },
      { section: "picks", url: "https://news.example.com/d", my_headline: "Pick D" },
      { section: "picks", url: "https://news.example.com/e", my_headline: "Pick E, one too many" },
      { section: "lead", url: "https://news.example.com/lead", my_headline: "MY LEAD" },
      { section: "world", url: "https://news.example.com/hormuz", my_headline: "Hormuz, from Dubai" },
      { issue_date: "2026-12-01", url: "https://news.example.com/later", my_headline: "Not yet" },
      { url: "https://news.example.com/used", my_headline: "Already used", status: "used 2026-10-26" },
    ],
    desk: [{ teaser: "This week's note", url: "https://docs.google.com/document/d/x/view" }],
  };
  const { edition } = dryRun({ inbox });
  const items = allItems(edition);
  assert.equal(edition.lead.headline, "MY LEAD");
  assert.deepEqual(edition.desk, { teaser: "This week's note", url: "https://docs.google.com/document/d/x/view" });
  const picks = edition.sections.find((s) => s.key === "picks");
  assert.deepEqual(picks.items.map((i) => i.headline), ["Pick A", "Pick B", "Pick C", "Pick D"], "4 picks; the fifth waits");
  assert.equal(picks.items[0].subscriber, true);
  assert.equal(picks.items[1].important, true);
  assert.equal(picks.items[2].for, "asha");
  assert.equal(edition.sections.find((s) => s.key === "world").items[0].headline, "Hormuz, from Dubai", "editor links lead their section");
  for (const h of ["Not yet", "Already used", "Pick E, one too many"]) assert.ok(!items.some((i) => i.headline === h), `${h} left out`);
  assert.ok(items.length <= settings.maxLinks, `${items.length} links`);
});

test("a live focus gets its own section first; pinned links count towards the limit", () => {
  const config = JSON.parse(readFileSync(path.join(root, "config", "focus.json"), "utf8"));
  for (const f of config.focuses) Object.assign(f, { enabled: true, start: "2026-10-30" });
  const { edition } = dryRun({ focus: config });
  assert.deepEqual(edition.sections.slice(0, 2).map((s) => s.key), ["campus", "mideast"]);
  assert.equal(edition.sections[0].focus, true);
  assert.equal(edition.sections[0].day, 1);
  const pins = config.focuses.find((f) => f.key === "campus").pins || [];
  pins.forEach((p, n) => assert.equal(edition.sections[0].items[n].pinned, true, "pinned starter links come first"));
  assert.ok(allItems(edition).length <= settings.maxLinks);
});

test("the archive keeps the last 8 issues and issue numbers keep counting", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tldr-arch-"));
  mkdirSync(path.join(out, "editions"));
  const old = ["2026-09-25", "2026-09-28", "2026-10-02", "2026-10-05", "2026-10-09", "2026-10-12", "2026-10-16", "2026-10-19", "2026-10-23"];
  for (const d of old) writeFileSync(path.join(out, "editions", `${d}.json`), "{}");
  writeFileSync(path.join(out, "index.json"), JSON.stringify({ lastIssue: 9, editions: old.map((d, n) => ({ date: d, issue: n + 1 })) }));
  const { index, edition } = dryRun({ out });
  assert.equal(edition.issue, 10);
  assert.equal(readdirSync(path.join(out, "editions")).filter((f) => f.endsWith(".json")).length, 8);
  assert.equal(index.latest, "2026-10-30");
  assert.ok(!index.dates.includes("2026-09-25"));
});

test("an expired or disabled focus leaves the page unchanged", async () => {
  const { loadFocus } = await import("../scripts/lib/focus.mjs");
  const out = mkdtempSync(path.join(tmpdir(), "tldr-focus-"));
  const f = { key: "x", title: "X", enabled: true, start: "2026-01-01", days: 21, maxLinks: 3, brief: "prompts/focus/_TEMPLATE.md", keywords: [] };
  writeFileSync(path.join(out, "f.json"), JSON.stringify({ focuses: [f, { ...f, key: "y", enabled: false, start: "2026-10-01", days: 100 }] }));
  assert.equal((await loadFocus(root, "2026-01-21", path.join(out, "f.json"))).active.length, 1, "day 21 is live");
  assert.equal((await loadFocus(root, "2026-01-22", path.join(out, "f.json"))).active.length, 0, "day 22 has ended");
});

test("website sources: finds an advertised feed, else reads article links and dates them by first sight", () => {
  const page = "https://example.org/campaign";
  assert.equal(discoverFeed('<link rel="alternate" type="application/rss+xml" href="/feed.xml">', page), "https://example.org/feed.xml");
  assert.equal(discoverFeed("<html></html>", page), "");

  const html = `<a href="/about">About us</a><a href="/donate">Donate to the movement today please</a>
    <a href="/news/a">Students march on the Election Commission in large numbers</a>
    <a href="/news/a">Students march on the Election Commission in large numbers</a>
    <a href="https://other.org/x">An external link that should never be included here</a>`;
  const seen = {};
  const now = Date.parse("2026-10-25T00:00:00Z");
  const first = extractSiteLinks(html, { name: "Site", role: "prefer", url: page }, seen, now);
  assert.deepEqual(first.map((i) => i.url), ["https://example.org/news/a"], "nav, duplicate and external links dropped");
  assert.equal(first[0].published, "2026-10-23T00:00:00.000Z", "links present on the first visit are back-dated 48h");

  const later = extractSiteLinks(html + '<a href="/news/b">A brand new statement from the student union today</a>', { name: "Site", role: "prefer", url: page }, seen, now + 86400e3);
  assert.equal(later.find((i) => i.url.endsWith("/news/b")).published, "2026-10-26T00:00:00.000Z", "new links dated when first seen");
  assert.equal(later.find((i) => i.url.endsWith("/news/a")).published, "2026-10-23T00:00:00.000Z", "old links keep their first-seen date");
});

test("Sheet rows: date cells the Sheet converted to real dates still read as YYYY-MM-DD", () => {
  const rows = normaliseRows([
    ["Date ", "id", "rank", "my_headline"],
    ["2026-10-25", "a", 1, " Text date "],
    [46320, "b", 2, "Real date cell"],
    ["2026-10-24", "c"],
  ]);
  assert.deepEqual(rows.map((r) => r.date), ["2026-10-25", "2026-10-25", "2026-10-24"]);
  assert.equal(rows[0].my_headline, "Text date");
  assert.equal(rows[1].rank, "2");
  assert.equal(rows[2].my_headline, "");
  assert.equal(rows[1]._row, 3);
});

test("Sheet rows: a deleted heading falls back to the standard column name", () => {
  const rows = normaliseRows(
    [
      ["", "id", "section", "rank", "source", "url", "original_headline", "ai_headline", "my_headline", "status"],
      ["2026-10-25", "a", "india", 1, "Scroll", "https://e.org/a", "Orig", "AI", "Mine", "hide"],
    ],
    "Today",
  );
  assert.equal(rows[0].date, "2026-10-25");
  assert.equal(rows[0].my_headline, "Mine");
  assert.equal(rows[0].status, "hide");
});
