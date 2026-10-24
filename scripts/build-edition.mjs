// Builds one day's edition: fetch feeds, pick stories, rewrite headlines, publish JSON, sync the Google Sheet.
// Usage: node scripts/build-edition.mjs [--dry-run] [--out <dir>] [--focus <focus.json>]
//   --dry-run  reads test/fixtures instead of the internet and skips Claude and Sheets.
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, fetchOgImage, fetchYoutubeMeta, shortId } from "./lib/feeds.mjs";
import { makeClient, selectStories, rewriteHeadlines, verifyHeadlines } from "./lib/claude.mjs";
import { loadFocus, effectiveSections, focusPromptBlock, focusToneBlock } from "./lib/focus.mjs";
import { sheetsConfigured, ensureTabs, readRows, writeRows, clearTab, appendRows, toRow } from "../lib/sheets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const focusPath = args.includes("--focus") ? path.resolve(args[args.indexOf("--focus") + 1]) : undefined;
const outDir = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : path.join(root, "public", "data");

const PRICES = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));
const istDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

const report = { started: new Date().toISOString(), dryRun, warnings: [], usage: [] };

async function main() {
  const settings = await readJson("config/settings.json");
  const { sources: regularSources } = await readJson("config/sources.json");
  settings.today = process.env.EDITION_DATE || istDate();
  report.date = settings.today;

  // Focus topics live today get their own sections first; the regular sections shrink.
  const focus = await loadFocus(root, settings.today, focusPath);
  settings.sections = effectiveSections(settings.sections, focus);
  report.focus = focus.active.map((f) => ({ key: f.key, title: f.title, day: f.day, of: f.days }));
  const sources = [...regularSources, ...focus.active.flatMap((f) => (f.sources || []).map((s) => ({ ...s, focus: f.key })))];

  // 1. Fetch every feed.
  const ytCachePath = path.join(root, "config", "youtube-ids.json");
  const ytCache = await readFile(ytCachePath, "utf8").then(JSON.parse).catch(() => ({}));
  const readFixture = dryRun ? (s) => readFile(path.join(root, "test", "fixtures", `${shortId(s.name)}.xml`), "utf8") : undefined;
  const { items, health } = await fetchAll(sources, { ytCache, readFixture });
  if (!dryRun) await writeFile(ytCachePath, JSON.stringify(ytCache, null, 2) + "\n");
  report.feeds = health.sort((a, b) => a.source.localeCompare(b.source));
  const failed = health.filter((h) => !h.ok).length;
  report.emptyFeeds = health.filter((h) => h.ok && h.items === 0).map((h) => h.source);
  if (failed / sources.length > 0.3) report.warnings.push(`${failed} of ${sources.length} feeds failed`);

  // 2. Keep recent, unique, linkable candidates.
  const cutoff = dryRun ? 0 : Date.now() - settings.lookbackHours * 3600e3;
  const focusCutoff = dryRun ? 0 : Date.now() - Math.max(settings.lookbackHours, ...focus.active.map((f) => f.lookbackHours || 0)) * 3600e3;
  const isFocusMatch = (i) => focus.active.some((f) => f.matches(i));
  const paywalled = (url) => settings.paywalledDomains.some((d) => new URL(url).hostname.replace(/^www\./, "").endsWith(d));
  const seenUrl = new Set();
  const seenTitle = new Set();
  const perSource = {};
  const candidates = items
    .filter((i) => i.title && /^https?:\/\//.test(i.url) && !i.isShort && i.published)
    .filter((i) => Date.parse(i.published) >= cutoff || (Date.parse(i.published) >= focusCutoff && isFocusMatch(i)))
    .sort((a, b) => b.published.localeCompare(a.published))
    .filter((i) => {
      const t = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seenUrl.has(i.url) || seenTitle.has(t)) return false;
      perSource[i.source] = (perSource[i.source] || 0) + 1;
      if (perSource[i.source] > settings.maxItemsPerFeed) return false;
      seenUrl.add(i.url);
      seenTitle.add(t);
      return true;
    })
    .map((i, n) => ({ ...i, cid: `c${n + 1}`, paywalled: paywalled(i.url), focusOnly: Date.parse(i.published) < cutoff }));
  report.candidates = candidates.length;
  // How much raw material each focus had today: tells us whether its link count is realistic.
  report.focusCoverage = Object.fromEntries(focus.active.map((f) => [f.key, candidates.filter((c) => f.matches(c)).length]));
  if (candidates.length < 30) throw new Error(`Only ${candidates.length} candidate items; feeds look broken, keeping yesterday's page`);
  const byCid = new Map(candidates.map((c) => [c.cid, c]));

  // 3. Pick the stories.
  const client = dryRun ? null : makeClient();
  let selection;
  if (dryRun) selection = heuristicSelect(candidates, settings, focus);
  else {
    const editorial = (await readFile(path.join(root, "prompts", "editorial.md"), "utf8")) + focusPromptBlock(focus, settings);
    const res = await selectStories({ client, settings, editorial, candidates });
    report.usage.push({ step: "select", model: res.model, ...res.usage });
    selection = res.data;
  }
  const picks = validatePicks(selection, byCid, settings);

  // 4. Collect the editor's corrections, then rewrite the headlines.
  const useSheets = !dryRun && sheetsConfigured();
  let todayRows = [];
  let styleExamples = [];
  if (useSheets) {
    try {
      await ensureTabs();
      todayRows = await readRows("Today");
      styleExamples = await syncStyle(todayRows);
    } catch (err) {
      report.warnings.push(`Google Sheet read failed: ${err.message}`);
    }
  } else if (!dryRun) report.notes = ["Google Sheet not configured yet (SHEET_ID / GOOGLE_SA_KEY missing); page published without it"];

  let rewritten = {};
  if (!dryRun) {
    const voice = (await readFile(path.join(root, "prompts", "voice.md"), "utf8")) + focusToneBlock(focus);
    const res = await rewriteHeadlines({ client, settings, voice, styleExamples, picks });
    report.usage.push({ step: "rewrite", model: res.model, ...res.usage });
    rewritten = Object.fromEntries(res.data.headlines.map((h) => [h.item_id, h.headline]));

    const pairs = picks.filter((p) => rewritten[p.cid]).map((p) => ({ ...p, headline: rewritten[p.cid] }));
    const check = await verifyHeadlines({ client, settings, pairs });
    report.usage.push({ step: "verify", model: check.model, ...check.usage });
    report.factCheck = [];
    for (const r of check.data.results) {
      if (r.supported || !rewritten[r.item_id]) continue;
      report.factCheck.push({ rejected: rewritten[r.item_id], original: byCid.get(r.item_id)?.title, problem: r.problem });
      delete rewritten[r.item_id];
    }
  }
  const tidy = (h, fallback) => {
    const s = (h || "").replace(/\s*—\s*/g, ": ").replace(/\s+/g, " ").trim();
    return s && s.length <= 120 ? s : fallback;
  };

  // 5. Thumbnails for the lead and the top story of each section.
  const needsThumb = picks.filter((p) => p.isLead || p.rank === 1);
  await Promise.all(
    needsThumb.map(async (p) => {
      p.thumb = p.image || (dryRun ? "" : await fetchOgImage(p.url));
    }),
  );

  // 6. Assemble and publish the edition.
  const toItem = (p) => ({
    id: p.id,
    section: p.isLead ? "lead" : p.section,
    rank: p.rank,
    headline: tidy(rewritten[p.cid], p.title),
    original_headline: p.title,
    url: p.url,
    source: p.source,
    tag: p.tag || undefined,
    kind: p.kind,
    thumbnail: p.thumb || undefined,
    helpline: p.helpline || undefined,
  });
  // Pinned starter links from config/focus.json sit at the top of their focus section, outside its link cap.
  const pinsBySection = {};
  for (const f of focus.active) {
    pinsBySection[f.key] = [];
    for (const pin of f.pins || []) {
      const meta = dryRun ? { url: pin.url, title: "", source: "YouTube" } : (await fetchYoutubeMeta(pin.url)) || { url: pin.url, title: "", source: new URL(pin.url).hostname };
      const title = pin.headline || meta.title || "Start here";
      pinsBySection[f.key].push({ id: shortId(meta.url), section: f.key, rank: 0, headline: title, original_headline: title, url: meta.url, source: meta.source, kind: /youtube\.com/.test(meta.url) ? "video" : "article", thumbnail: meta.image, pinned: true });
    }
  }
  const pinnedUrls = new Set(Object.values(pinsBySection).flat().map((p) => p.url));
  const lead = picks.find((p) => p.isLead);
  const edition = {
    date: settings.today,
    generated_at: new Date().toISOString(),
    lead: lead ? toItem(lead) : null,
    sections: settings.sections.map((s) => ({
      key: s.key,
      title: s.title,
      ...(s.focus ? { focus: true, day: s.day, days: s.days } : {}),
      items: [...(pinsBySection[s.key] || []), ...picks.filter((p) => !p.isLead && p.section === s.key && !pinnedUrls.has(p.url)).map(toItem)],
    })),
  };
  for (const s of settings.sections.filter((x) => !x.focus)) {
    const got = edition.sections.find((x) => x.key === s.key).items.length;
    if (got < s.quota - 1) report.warnings.push(`Section ${s.title} has ${got} of ${s.quota} links`);
  }
  await publish(edition, settings);

  // 7. Mirror the edition into the Sheet for curation.
  if (useSheets) {
    try {
      await syncToday(todayRows, edition, settings);
    } catch (err) {
      report.warnings.push(`Google Sheet write failed: ${err.message}`);
    }
  }
  report.picks = Object.fromEntries(edition.sections.map((s) => [s.key, s.items.length]));
  report.picksDetail = picks.map((p) => ({ section: p.isLead ? "lead" : p.section, path: p.path, story: p.story, source: p.source }));
  report.lead = edition.lead?.headline;
}

function validatePicks(selection, byCid, settings) {
  const used = new Set();
  const out = [];
  let independent = 0;
  const take = (p, isLead) => {
    const item = byCid.get(p.item_id);
    if (!item || used.has(item.cid) || item.paywalled || item.isShort) return;
    const section = settings.sections.find((s) => s.key === p.section);
    if (!section || (item.focusOnly && !section.focus)) return;
    // Focus briefs may let single-source items in, so the daily cap applies to regular sections only.
    if (p.path === "independent" && !section.focus && ++independent > settings.independentPathMax) return;
    const rank = out.filter((o) => !o.isLead && o.section === p.section).length + 1;
    if (!isLead && rank > section.quota) return;
    used.add(item.cid);
    out.push({ ...item, section: p.section, rank: isLead ? 0 : rank, isLead, helpline: p.helpline, story: p.story, path: p.path });
  };
  if (selection.lead) take(selection.lead, true);
  for (const p of selection.picks || []) take(p, false);
  return out;
}

// Dry-run stand-in for Claude: sorts candidates into sections by source and keywords.
function heuristicSelect(candidates, settings, focus) {
  const neutralSection = {
    ESPNcricinfo: "sports", "BBC Sport": "sports", "BBC Football": "sports",
    "BBC Entertainment": "culture", "Film Companion": "culture", Soompi: "culture",
    "The Verge": "techmoney", TechCrunch: "techmoney", "Mint Markets": "techmoney",
    "Carbon Brief": "world", "Mongabay India": "india",
    "Know Your Meme": "internet", "Garbage Day": "internet", "GQ India": "internet", Highsnobiety: "internet",
  };
  const indiaWords = /india|delhi|mumbai|modi|bjp|congress|rahul|kerala|bihar|tamil|karnataka|maharashtra|rupee|lok sabha|data bill|data protection|exam|metro|night-bus/i;
  const pool = candidates.filter((c) => c.role !== "detect" && !c.paywalled);
  const sectionFor = (c) => {
    const f = focus.active.find((x) => x.matches(c));
    if (f) return f.key;
    if (c.focusOnly) return null;
    return c.role === "neutral" ? neutralSection[c.source] || "world" : indiaWords.test(c.title + c.summary) ? "india" : "world";
  };
  const picks = pool.filter((c) => sectionFor(c)).map((c) => ({
    item_id: c.cid,
    section: sectionFor(c),
    story: c.title.slice(0, 60),
    path: c.role === "neutral" ? "neutral" : "independent",
    helpline: false,
  }));
  const lead = picks.find((p) => p.section === "india") || picks[0];
  return { lead: { ...lead, path: "consensus" }, picks: picks.filter((p) => p !== lead).map((p) => ({ ...p, path: p.path === "independent" ? "consensus" : p.path })) };
}

async function publish(edition, settings) {
  const editionsDir = path.join(outDir, "editions");
  await mkdir(editionsDir, { recursive: true });
  await writeFile(path.join(editionsDir, `${edition.date}.json`), JSON.stringify(edition, null, 2) + "\n");
  const oldest = istDate(new Date(Date.parse(`${edition.date}T12:00:00+05:30`) - (settings.archiveDays - 1) * 86400e3));
  const dates = [];
  for (const f of await readdir(editionsDir)) {
    const d = f.replace(/\.json$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d < oldest) await unlink(path.join(editionsDir, f));
    else dates.push(d);
  }
  dates.sort().reverse();
  await writeFile(path.join(outDir, "index.json"), JSON.stringify({ latest: dates[0], dates, siteName: settings.siteName, footerNote: settings.footerNote, helpline: settings.helpline }, null, 2) + "\n");
}

// Copies rows the editor rewrote into the Style tab and returns the 30 most recent corrections.
async function syncStyle(todayRows) {
  const style = await readRows("Style");
  const have = new Set(style.map((r) => r.id));
  const fresh = todayRows.filter((r) => r.my_headline && r.ai_headline && !have.has(r.id));
  if (fresh.length) await appendRows("Style", fresh.map((r) => toRow("Style", r)));
  return [...style, ...fresh].reverse().slice(0, 30);
}

async function syncToday(existing, edition, settings) {
  const oldest = istDate(new Date(Date.parse(`${edition.date}T12:00:00+05:30`) - (settings.archiveDays - 1) * 86400e3));
  const edited = (r) => r.my_headline || r.status || !r.ai_headline;
  const pinned = (r) => r.status.trim().toLowerCase() === "pin";
  const keep = existing.filter((r) => pinned(r) || (r.date >= oldest && (r.date !== edition.date || edited(r))));
  const kept = new Set(keep.filter((r) => r.date === edition.date).map((r) => r.id));
  const items = [edition.lead, ...edition.sections.flatMap((s) => s.items)].filter(Boolean);
  const fresh = items
    .filter((i) => !kept.has(i.id))
    .map((i) => ({ date: edition.date, id: i.id, section: i.section, rank: i.rank, source: i.source, url: i.url, original_headline: i.original_headline, ai_headline: i.headline, my_headline: "", status: "", thumbnail: i.thumbnail || "" }));
  const rows = [...fresh, ...keep].map((r) => toRow("Today", r));
  await clearTab("Today");
  if (rows.length) await writeRows("Today!A2", rows);
}

async function writeReport() {
  report.finished = new Date().toISOString();
  report.estimatedCostUsd = Number(
    report.usage
      .reduce((sum, u) => {
        const [i, o] = PRICES[u.model] || PRICES["claude-opus-5-5"];
        return sum + ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o) / 1e6;
      }, 0)
      .toFixed(4),
  );
  const dir = dryRun ? outDir : path.join(root, "reports");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "last-run.json"), JSON.stringify(report, null, 2) + "\n");
}

main()
  .then(async () => {
    await writeReport();
    console.log(`Edition ${report.date}: ${report.candidates} candidates, picks ${JSON.stringify(report.picks)}, est. $${report.estimatedCostUsd}`);
    for (const w of report.warnings) console.log(`WARNING: ${w}`);
  })
  .catch(async (err) => {
    report.fatal = String(err.stack || err);
    await writeReport().catch(() => {});
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
