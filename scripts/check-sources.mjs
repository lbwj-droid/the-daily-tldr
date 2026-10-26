// Reads every source (regular and live focus topics) and prints what worked. No Claude calls, nothing published.
// Run from GitHub: Actions -> Check sources -> Run workflow.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll } from "./lib/feeds.mjs";
import { loadFocus } from "./lib/focus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));

const settings = await readJson("config/settings.json");
const { sources } = await readJson("config/sources.json");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date());
const focus = await loadFocus(root, today);
const all = [...sources, ...focus.active.flatMap((f) => f.sources || [])];
const ytCache = await readJson("config/youtube-ids.json").catch(() => ({}));
const { items, health } = await fetchAll(all, { ytCache, youtubeKey: process.env.YOUTUBE_API_KEY });

const lines = health
  .sort((a, b) => Number(a.ok) - Number(b.ok) || a.source.localeCompare(b.source))
  .map((h) => `| ${h.ok ? "ok" : "FAILED"} | ${h.source} | ${h.ok ? h.items : "-"} | ${h.ok ? h.via || "feed" : h.error} |`);
const videos = items.filter((i) => i.kind === "video");
const summary = [
  `## Source check, ${today}`,
  "",
  `${health.filter((h) => h.ok).length} of ${health.length} sources worked; ${items.length} items, ${videos.length} of them videos (${videos.filter((v) => v.seconds != null).length} with a known length).`,
  `YouTube API key present: ${process.env.YOUTUBE_API_KEY ? "yes" : "no"}.`,
  "",
  "| Status | Source | Items | How / error |",
  "| --- | --- | --- | --- |",
  ...lines,
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await import("node:fs/promises").then((fs) => fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n"));
