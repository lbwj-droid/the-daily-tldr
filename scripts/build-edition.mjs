// Builds one issue (Monday and Friday): read the editor's Inbox and Desk tabs, fetch feeds, pick stories within the
// issue's link budget, rewrite and fact-check headlines, publish JSON (shown to readers from goLive, Dubai time),
// and sync the Google Sheet.
// Usage: node scripts/build-edition.mjs [--dry-run] [--out <dir>] [--focus <focus.json>] [--inbox <inbox.json>]
//   --dry-run  reads test/fixtures instead of the internet and skips Claude and Sheets.
//   --inbox    with --dry-run: a JSON file {"inbox": [...], "desk": [...]} standing in for the Sheet's Inbox and Desk tabs.
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, fetchOgImage, fetchYoutubeMeta, fetchVideoSeconds, fetchPageMeta, isHindi, shortId, pruneSiteSeen } from "./lib/feeds.mjs";
import { makeClient, selectStories, rewriteHeadlines, verifyHeadlines } from "./lib/claude.mjs";
import { loadFocus, effectiveSections, focusPromptBlock, focusToneBlock } from "./lib/focus.mjs";
import { sheetsConfigured, ensureTabs, readRows, writeRows, clearTab, appendRows, toRow, columnOf, TABS } from "../lib/sheets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? path.resolve(args[args.indexOf(name) + 1]) : undefined);
const dryRun = args.includes("--dry-run");
const focusPath = arg("--focus");
const inboxPath = arg("--inbox");
const outDir = arg("--out") || path.join(root, "public", "data");

const PRICES = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));
const localDate = (tz, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const usedMark = (date) => `used ${date}`;

const report = { started: new Date().toISOString(), dryRun, warnings: [], usage: [] };

async function main() {
  const settings = await readJson("config/settings.json");
  const { sources: regularSources } = await readJson("config/sources.json");
  settings.today = process.env.EDITION_DATE || localDate(settings.timezone);
  report.date = settings.today;

  // The issue window runs from the previous issue to now, so a Monday issue covers the weekend.
  const index = await readFile(path.join(outDir, "index.json"), "utf8").then(JSON.parse).catch(() => null);
  const editions = index?.editions || (index?.dates || []).map((date) => ({ date }));
  const previous = editions.filter((e) => e.date < settings.today).sort((a, b) => b.date.localeCompare(a.date))[0];
  const previousAt = previous ? Date.parse(previous.generated_at || `${previous.date}T05:30:00${settings.utcOffset}`) : null;
  const lookbackHours = clamp(previousAt ? (Date.now() - previousAt) / 3600e3 + 6 : 96, settings.minLookbackHours, settings.maxLookbackHours);
  const windowText = previous ? `the stories since the previous issue on ${previous.date}` : "the stories of the last few days";
  const issue = editions.find((e) => e.date === settings.today)?.issue || (index?.lastIssue || 0) + 1;
  report.issue = issue;
  report.lookbackHours = Math.round(lookbackHours);

  // Focus topics live today get their own sections, ahead of the regular ones.
  const focus = await loadFocus(root, settings.today, focusPath);
  const sections = effectiveSections(settings.sections, focus);
  report.focus = focus.active.map((f) => ({ key: f.key, title: f.title, day: f.day, of: f.days }));
  const sources = [...regularSources, ...focus.active.flatMap((f) => (f.sources || []).map((s) => ({ ...s, focus: f.key })))];

  // 1. The editor's links and notes for this issue (Sheet Inbox and Desk tabs).
  const useSheets = !dryRun && sheetsConfigured();
  let todayRows = [];
  let inboxRows = [];
  let deskRows = [];
  let styleExamples = [];
  if (useSheets) {
    try {
      await ensureTabs();
      [todayRows, inboxRows, deskRows] = await Promise.all([readRows("Today"), readRows("Inbox"), readRows("Desk")]);
      styleExamples = await syncStyle(todayRows);
    } catch (err) {
      report.warnings.push(`Google Sheet read failed: ${err.message}`);
    }
  } else if (dryRun && inboxPath) {
    const fixture = JSON.parse(await readFile(inboxPath, "utf8"));
    inboxRows = (fixture.inbox || []).map((r, n) => ({ status: "", ...r, _row: n + 2 }));
    deskRows = (fixture.desk || []).map((r, n) => ({ status: "", ...r, _row: n + 2 }));
  } else if (!dryRun) report.notes = ["Google Sheet not configured yet (SHEET_ID / GOOGLE_SA_KEY missing); issue published without it"];
  const manual = await collectManual(inboxRows, deskRows, sections, settings);

  // 2. Fetch every feed.
  const ytCachePath = path.join(root, "config", "youtube-ids.json");
  const ytCache = await readFile(ytCachePath, "utf8").then(JSON.parse).catch(() => ({}));
  const readFixture = dryRun ? (s) => readFile(path.join(root, "test", "fixtures", `${shortId(s.name)}.${s.kind === "site" ? "html" : "xml"}`), "utf8") : undefined;
  const siteSeenPath = path.join(root, "config", "site-seen.json");
  const siteSeen = dryRun ? {} : await readFile(siteSeenPath, "utf8").then(JSON.parse).catch(() => ({}));
  const { items, health } = await fetchAll(sources, { ytCache, readFixture, siteSeen, youtubeKey: process.env.YOUTUBE_API_KEY });
  if (!dryRun) {
    await writeFile(ytCachePath, JSON.stringify(ytCache, null, 2) + "\n");
    await writeFile(siteSeenPath, JSON.stringify(pruneSiteSeen(siteSeen), null, 2) + "\n");
  }
  report.feeds = health.sort((a, b) => a.source.localeCompare(b.source));
  const failed = health.filter((h) => !h.ok).length;
  report.emptyFeeds = health.filter((h) => h.ok && h.items === 0).map((h) => h.source);
  if (failed / sources.length > 0.3) report.warnings.push(`${failed} of ${sources.length} feeds failed`);

  // 3. Keep recent, unique, linkable candidates that the editor has not already placed.
  const cutoff = dryRun ? 0 : Date.now() - lookbackHours * 3600e3;
  const focusCutoff = dryRun ? 0 : Date.now() - Math.max(lookbackHours, ...focus.active.map((f) => f.lookbackHours || 0)) * 3600e3;
  const isFocusMatch = (i) => focus.active.some((f) => f.matches(i));
  const paywalled = (url) => settings.paywalledDomains.some((d) => new URL(url).hostname.replace(/^www\./, "").endsWith(d));
  const manualUrls = new Set(manual.all.map((m) => m.url));
  const seenUrl = new Set();
  const seenTitle = new Set();
  const perSource = {};
  let candidates = items
    .filter((i) => i.title && /^https?:\/\//.test(i.url) && !i.isShort && i.published && !manualUrls.has(i.url))
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
    });

  // Videos longer than maxVideoMinutes are dropped; YouTube feeds carry no length, so each watch page is checked.
  if (!dryRun) {
    const videos = candidates.filter((c) => c.kind === "video");
    // Videos read through the YouTube API already carry their length; only feed-sourced ones need a page check.
    await pool(videos.filter((v) => v.seconds == null), 8, async (v) => (v.seconds = await fetchVideoSeconds(v.url)));
    const tooLong = videos.filter((v) => v.seconds && v.seconds > settings.maxVideoMinutes * 60);
    report.videosDroppedTooLong = tooLong.length;
    report.videosLengthUnknown = videos.filter((v) => v.seconds == null).length;
    candidates = candidates.filter((c) => !tooLong.includes(c));
  }
  candidates = candidates.map((i, n) => ({ ...i, cid: `c${n + 1}`, paywalled: paywalled(i.url), focusOnly: Date.parse(i.published) < cutoff, hindi: isHindi(i) }));
  report.candidates = candidates.length;
  report.focusCoverage = Object.fromEntries(focus.active.map((f) => [f.key, candidates.filter((c) => f.matches(c)).length]));
  if (candidates.length < 30) throw new Error(`Only ${candidates.length} candidate items; feeds look broken, keeping the previous issue`);
  const byCid = new Map(candidates.map((c) => [c.cid, c]));

  // 4. The link budget: maxLinks in total, counting the lead, the editor's links and pinned starter links.
  const pinCount = focus.active.reduce((n, f) => n + (f.pins || []).length, 0);
  const needLead = !manual.lead;
  const budget = Math.max(0, settings.maxLinks - manual.all.length - pinCount - (needLead ? 1 : 0));
  const caps = sections.map((s) => ({ ...s, max: Math.max(0, s.max - (manual.bySection[s.key] || []).length) })).filter((s) => s.max > 0);
  report.budget = { maxLinks: settings.maxLinks, editorLinks: manual.all.length, pinned: pinCount, claudeLinks: budget, claudeLead: needLead };
  if (manual.all.length + pinCount > settings.maxLinks) report.warnings.push(`The editor's links and pinned links (${manual.all.length + pinCount}) exceed the ${settings.maxLinks}-link limit; all were kept`);

  // 5. Pick the stories.
  const client = dryRun ? null : makeClient();
  let selection = { picks: [] };
  if (dryRun) selection = heuristicSelect(candidates, caps, focus, needLead);
  else if (budget > 0 || needLead) {
    const editorial = (await readFile(path.join(root, "prompts", "editorial.md"), "utf8")) + focusPromptBlock(focus, settings);
    const res = await selectStories({ client, settings, editorial, candidates, sections: caps, budget, needLead, manual: manual.all, windowText });
    report.usage.push({ step: "select", model: res.model, ...res.usage });
    selection = res.data;
  }
  const picks = validatePicks(selection, byCid, settings, caps, budget, needLead);

  // 6. Rewrite headlines (Claude's picks, plus the editor's links that came without a headline), then fact-check them.
  const toRewrite = [...picks, ...manual.all.filter((m) => !m.headline && m.title)];
  let rewritten = {};
  if (!dryRun && toRewrite.length) {
    const voice = (await readFile(path.join(root, "prompts", "voice.md"), "utf8")) + focusToneBlock(focus);
    const res = await rewriteHeadlines({ client, settings, voice, styleExamples, picks: toRewrite });
    report.usage.push({ step: "rewrite", model: res.model, ...res.usage });
    rewritten = Object.fromEntries(res.data.headlines.map((h) => [h.item_id, h.headline]));

    const pairs = toRewrite.filter((p) => rewritten[p.cid]).map((p) => ({ ...p, headline: rewritten[p.cid] }));
    const check = await verifyHeadlines({ client, settings, pairs });
    report.usage.push({ step: "verify", model: check.model, ...check.usage });
    report.factCheck = [];
    for (const r of check.data.results) {
      if (r.supported || !rewritten[r.item_id]) continue;
      report.factCheck.push({ rejected: rewritten[r.item_id], original: toRewrite.find((p) => p.cid === r.item_id)?.title, problem: r.problem });
      delete rewritten[r.item_id];
    }
  }
  const tidy = (h, fallback) => {
    const s = (h || "").replace(/\s*—\s*/g, ": ").replace(/\s+/g, " ").trim();
    return s && s.length <= 120 ? s : fallback;
  };

  // 7. Pinned starter links from config/focus.json.
  const pinsBySection = {};
  for (const f of focus.active) {
    pinsBySection[f.key] = [];
    for (const pin of f.pins || []) {
      const meta = dryRun ? { url: pin.url, title: "", source: "YouTube" } : (await fetchYoutubeMeta(pin.url)) || { url: pin.url, title: "", source: new URL(pin.url).hostname };
      const title = pin.headline || meta.title || "Start here";
      pinsBySection[f.key].push({ id: shortId(meta.url), section: f.key, rank: 0, headline: title, original_headline: title, url: meta.url, source: meta.source, kind: /youtube\.com/.test(meta.url) ? "video" : "article", thumbnail: meta.image, pinned: true });
    }
  }

  // 8. Assemble the issue.
  const toItem = (p, section, rank) => ({
    id: p.id,
    section,
    rank,
    headline: p.headline || tidy(rewritten[p.cid], p.title || p.source),
    original_headline: p.title || undefined,
    url: p.url,
    source: p.source,
    tag: p.tag || undefined,
    kind: p.kind,
    thumbnail: p.thumb || undefined,
    helpline: p.helpline || undefined,
    important: p.important || undefined,
    for: p.for || undefined,
    subscriber: p.subscriber || undefined,
    manual: p.manual || undefined,
  });
  const autoLead = picks.find((p) => p.isLead);
  const leadSource = manual.lead || autoLead;
  const sectionItems = (key) => [
    ...(pinsBySection[key] || []),
    ...(manual.bySection[key] || []),
    ...picks.filter((p) => !p.isLead && p.section === key),
  ];
  const allSections = [
    ...(manual.picks.length ? [{ key: "picks", title: settings.picksTitle, editor: true }] : []),
    ...sections,
  ];
  const edition = {
    date: settings.today,
    issue,
    publish_at: new Date(`${settings.today}T${settings.goLive}:00${settings.utcOffset}`).toISOString(),
    generated_at: new Date().toISOString(),
    window_hours: Math.round(lookbackHours),
    desk: manual.desk ? { teaser: manual.desk.teaser || "Notes from the news desk", url: manual.desk.url } : null,
    lead: leadSource ? { ...toItem(leadSource, "lead", 0), home: leadSource.section !== "lead" ? leadSource.section : undefined } : null,
    sections: [],
  };
  for (const s of allSections) {
    const list = s.key === "picks" ? manual.picks : sectionItems(s.key);
    edition.sections.push({
      key: s.key,
      title: s.title,
      ...(s.editor ? { editor: true } : {}),
      ...(s.focus ? { focus: true, day: s.day, days: s.days } : {}),
      items: list.map((p, n) => (p.pinned ? p : toItem(p, s.key, n + 1))),
    });
  }

  // Thumbnails for the lead and the top link of each section.
  const needsThumb = [edition.lead, ...edition.sections.map((s) => s.items[0])].filter((i) => i && !i.thumbnail);
  await Promise.all(
    needsThumb.map(async (i) => {
      const src = [leadSource, ...picks, ...manual.all].find((p) => p && p.url === i.url);
      i.thumbnail = src?.image || (dryRun ? undefined : (await fetchOgImage(i.url)) || undefined);
    }),
  );

  const linkCount = (edition.lead ? 1 : 0) + edition.sections.reduce((n, s) => n + s.items.length, 0);
  report.links = linkCount;
  const retained = await publish(edition, settings, index);

  // 9. Mirror the issue into the Sheet and mark the editor's rows as used.
  if (useSheets) {
    try {
      await syncToday(todayRows, edition, retained);
      await markUsed(manual, settings.today);
    } catch (err) {
      report.warnings.push(`Google Sheet write failed: ${err.message}`);
    }
  }
  report.warnings.push(...manual.warnings);
  report.picks = Object.fromEntries(edition.sections.map((s) => [s.key, s.items.length]));
  report.picksDetail = picks.map((p) => ({ section: p.isLead ? "lead" : p.section, path: p.path, story: p.story, source: p.source, hindi: p.hindi || undefined }));
  report.lead = edition.lead?.headline;
}

// Reads the Inbox and Desk rows due for this issue and turns them into items (title, source and image fetched from the link).
async function collectManual(inboxRows, deskRows, sections, settings) {
  const today = settings.today;
  const due = (r) => {
    const status = String(r.status || "").trim();
    return (!status || status === usedMark(today)) && (!r.issue_date || r.issue_date <= today);
  };
  const keys = new Set(sections.map((s) => s.key));
  const out = { lead: null, picks: [], bySection: {}, all: [], usedRows: [], warnings: [], desk: null, deskRow: null };
  let n = 0;
  for (const r of inboxRows.filter((x) => due(x) && /^https?:\/\//.test(String(x.url || "").trim()))) {
    let section = String(r.section || "").trim().toLowerCase().replace(/[^a-z]/g, "");
    if (!section || section.startsWith("editor") || section === "pick") section = "picks";
    if (section !== "picks" && section !== "lead" && !keys.has(section)) {
      out.warnings.push(`Inbox row ${r._row}: unknown section "${r.section}", put in ${settings.picksTitle}`);
      section = "picks";
    }
    if (section === "lead" && out.lead) {
      out.warnings.push(`Inbox row ${r._row}: a second lead story; kept for the next issue`);
      continue;
    }
    if (section === "picks" && out.picks.length >= settings.picksMax) {
      out.warnings.push(`Inbox row ${r._row}: ${settings.picksTitle} already has ${settings.picksMax} links; kept for the next issue`);
      continue;
    }
    const url = String(r.url).trim();
    const meta = dryRun ? { title: r.title || "", source: new URL(url).hostname.replace(/^www\./, ""), image: "", kind: /youtube/.test(url) ? "video" : "article", url } : await fetchPageMeta(url);
    const yes = (v) => /^(y|yes|true|1|x)$/i.test(String(v || "").trim());
    const item = {
      cid: `m${++n}`,
      id: shortId(meta.url || url),
      url: meta.url || url,
      title: meta.title,
      summary: "",
      source: meta.source,
      kind: meta.kind,
      image: meta.image,
      headline: String(r.my_headline || "").trim() || (meta.title ? "" : meta.source),
      important: yes(r.important),
      for: String(r.for || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || undefined,
      subscriber: yes(r.subscriber),
      manual: true,
      section,
      isLead: section === "lead",
    };
    if (!item.headline && !item.title) out.warnings.push(`Inbox row ${r._row}: could not read a title for ${url}; add my_headline`);
    out.all.push(item);
    out.usedRows.push(r);
    if (section === "lead") out.lead = item;
    else if (section === "picks") out.picks.push(item);
    else (out.bySection[section] ||= []).push(item);
  }
  const desk = deskRows.find((r) => (r.issue_date === today || (!r.issue_date && !String(r.status || "").trim())) && (String(r.teaser || "").trim() || /^https?:\/\//.test(String(r.url || "").trim())));
  if (desk) {
    out.desk = { teaser: String(desk.teaser || "").trim(), url: String(desk.url || "").trim() || undefined };
    out.deskRow = desk;
  }
  return out;
}

function validatePicks(selection, byCid, settings, caps, budget, needLead) {
  const used = new Set();
  const out = [];
  let independent = 0;
  let hindi = 0;
  const take = (p, isLead) => {
    const item = byCid.get(p.item_id);
    if (!item || used.has(item.cid) || item.paywalled || item.isShort) return;
    const section = caps.find((s) => s.key === p.section);
    if (!section && !isLead) return;
    if (item.focusOnly && !section?.focus) return;
    if (item.hindi && hindi >= settings.hindiMax) return;
    // Focus briefs may let single-source items in, so the cap on that path applies to regular sections only.
    if (!isLead && p.path === "independent" && !section.focus && independent >= settings.independentPathMax) return;
    const rank = out.filter((o) => !o.isLead && o.section === p.section).length + 1;
    if (!isLead && (rank > section.max || out.filter((o) => !o.isLead).length >= budget)) return;
    if (!isLead && p.path === "independent" && !section.focus) independent++;
    if (item.hindi) hindi++;
    used.add(item.cid);
    out.push({ ...item, section: p.section, rank: isLead ? 0 : rank, isLead, helpline: p.helpline, story: p.story, path: p.path });
  };
  if (needLead && selection.lead) take(selection.lead, true);
  for (const p of selection.picks || []) take(p, false);
  return out;
}

// Dry-run stand-in for Claude: sorts candidates into sections by source and keywords, within the same caps.
function heuristicSelect(candidates, caps, focus, needLead) {
  const neutralSection = { "BBC Entertainment": "culture", Soompi: "culture", "Know Your Meme": "culture", "Carbon Brief": "world", "Mongabay India": "india" };
  const indiaWords = /india|delhi|mumbai|modi|bjp|congress|rahul|kerala|bihar|tamil|karnataka|maharashtra|rupee|lok sabha|data bill|data protection|exam|metro|night-bus/i;
  const pool = candidates.filter((c) => c.role !== "detect" && !c.paywalled);
  const keys = new Set(caps.map((s) => s.key));
  const sectionFor = (c) => {
    const f = focus.active.find((x) => x.matches(c));
    if (f) return f.key;
    if (c.focusOnly) return null;
    return c.role === "neutral" ? neutralSection[c.source] || "world" : indiaWords.test(c.title + c.summary) ? "india" : "world";
  };
  const picks = pool
    .map((c) => ({ item_id: c.cid, section: sectionFor(c), story: c.title.slice(0, 60), path: "consensus", helpline: false }))
    .filter((p) => p.section);
  const lead = needLead ? picks.find((p) => p.section === "india") || picks[0] : null;
  return { lead, picks: picks.filter((p) => p !== lead && keys.has(p.section)) };
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// Writes the issue and index.json, keeping the last archiveIssues issues. Returns the dates kept.
async function publish(edition, settings, index) {
  const editionsDir = path.join(outDir, "editions");
  await mkdir(editionsDir, { recursive: true });
  await writeFile(path.join(editionsDir, `${edition.date}.json`), JSON.stringify(edition, null, 2) + "\n");
  const known = Object.fromEntries((index?.editions || []).map((e) => [e.date, e]));
  known[edition.date] = { date: edition.date, issue: edition.issue, publish_at: edition.publish_at, generated_at: edition.generated_at };
  const dates = (await readdir(editionsDir)).map((f) => f.replace(/\.json$/, "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  const keep = dates.slice(0, settings.archiveIssues);
  for (const d of dates.slice(settings.archiveIssues)) await unlink(path.join(editionsDir, `${d}.json`));
  const list = keep.map((d) => known[d] || { date: d });
  await writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify(
      {
        latest: keep[0],
        editions: list,
        dates: keep,
        lastIssue: Math.max(edition.issue, index?.lastIssue || 0),
        siteName: settings.siteName,
        footerNote: settings.footerNote,
        helpline: settings.helpline,
        goLive: settings.goLive,
        timezone: settings.timezone,
      },
      null,
      2,
    ) + "\n",
  );
  return keep;
}

// Copies rows the editor rewrote into the Style tab and returns the 30 most recent corrections.
async function syncStyle(todayRows) {
  const style = await readRows("Style");
  const have = new Set(style.map((r) => r.id));
  const fresh = todayRows.filter((r) => r.my_headline && r.ai_headline && !have.has(r.id));
  if (fresh.length) await appendRows("Style", fresh.map((r) => toRow("Style", r)));
  return [...style, ...fresh].reverse().slice(0, 30);
}

async function syncToday(existing, edition, retained) {
  const kept = new Set(retained);
  const edited = (r) => r.my_headline || r.status || r.important || r.for || !r.ai_headline;
  const pinned = (r) => String(r.status || "").trim().toLowerCase() === "pin";
  const keep = existing.filter((r) => pinned(r) || (kept.has(r.date) && (r.date !== edition.date || edited(r))));
  const keptIds = new Set(keep.filter((r) => r.date === edition.date).map((r) => r.id));
  const items = [edition.lead, ...edition.sections.flatMap((s) => s.items)].filter(Boolean);
  const fresh = items
    .filter((i) => !keptIds.has(i.id))
    .map((i) => ({
      date: edition.date,
      id: i.id,
      section: i.section,
      rank: i.rank,
      source: i.source,
      url: i.url,
      original_headline: i.original_headline || "",
      ai_headline: i.manual ? "" : i.headline,
      my_headline: i.manual ? i.headline : "",
      status: "",
      important: i.important ? "yes" : "",
      for: i.for || "",
      thumbnail: i.thumbnail || "",
    }));
  const rows = [...fresh, ...keep].map((r) => toRow("Today", r));
  await clearTab("Today");
  await writeRows("Today!A1", [TABS.Today]);
  if (rows.length) await writeRows("Today!A2", rows);
}

async function markUsed(manual, date) {
  const col = columnOf("Inbox", "status");
  for (const r of manual.usedRows) await writeRows(`Inbox!${col}${r._row}`, [[usedMark(date)]]);
  if (manual.deskRow) {
    await writeRows(`Desk!${columnOf("Desk", "issue_date")}${manual.deskRow._row}`, [[date]]);
    await writeRows(`Desk!${columnOf("Desk", "status")}${manual.deskRow._row}`, [[usedMark(date)]]);
  }
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
    console.log(`Issue ${report.issue} (${report.date}): ${report.candidates} candidates, ${report.links} links ${JSON.stringify(report.picks)}, est. $${report.estimatedCostUsd}`);
    for (const w of report.warnings) console.log(`WARNING: ${w}`);
  })
  .catch(async (err) => {
    report.fatal = String(err.stack || err);
    await writeReport().catch(() => {});
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  });
