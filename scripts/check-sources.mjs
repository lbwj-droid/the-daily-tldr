// Reads every source (the Sheet's Sources tab, plus live focus topics), prints what worked and writes each source's
// health into the Sources tab. No Claude calls, nothing published.
// Run from GitHub: Actions -> Check sources -> Run workflow.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll } from "./lib/feeds.mjs";
import { loadFocus } from "./lib/focus.mjs";
import { loadSources, writeSourceHealth } from "./lib/sources.mjs";
import { sheetsConfigured } from "../lib/sheets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));

const settings = await readJson("config/settings.json");
const list = await loadSources(root, { useSheets: sheetsConfigured() });
const sources = list.sources;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date());
const focus = await loadFocus(root, today);
const all = [...sources, ...focus.active.flatMap((f) => f.sources || [])];
const ytCache = await readJson("config/youtube-ids.json").catch(() => ({}));
const { items, health } = await fetchAll(all, { ytCache, youtubeKey: process.env.YOUTUBE_API_KEY });
const when = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date()).replace(",", "");
await writeSourceHealth(list.rows, health, when).catch((err) => list.warnings.push(`Could not write health to the Sheet: ${err.message}`));

const lines = health
  .sort((a, b) => Number(a.ok) - Number(b.ok) || a.source.localeCompare(b.source))
  .map((h) => `| ${h.ok ? "ok" : "FAILED"} | ${h.source} | ${h.ok ? h.items : "-"} | ${h.ok ? h.via || "feed" : h.error} |`);
const videos = items.filter((i) => i.kind === "video");
const summary = [
  `## Source check, ${today}`,
  "",
  `${health.filter((h) => h.ok).length} of ${health.length} sources worked; ${items.length} items, ${videos.length} of them videos (${videos.filter((v) => v.seconds != null).length} with a known length).`,
  `YouTube API key present: ${process.env.YOUTUBE_API_KEY ? "yes" : "no"}. Sources read from: ${list.from === "copy" ? "the saved copy (Sheet not reachable)" : "the Sheet's Sources tab"}.`,
  ...[...list.notes, ...list.warnings].map((w) => `- ${w}`),
  "",
  "| Status | Source | Items | How / error |",
  "| --- | --- | --- | --- |",
  ...lines,
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await import("node:fs/promises").then((fs) => fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n"));
