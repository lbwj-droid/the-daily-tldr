// The Sources tab of the Google Sheet is the master list of sources. Each build reads it, writes each source's health
// back into it, and saves a copy to config/sources.json, which is used only when the Sheet cannot be read (and to fill
// an empty tab).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TABS, ensureTabs, readRows, writeRows, columnOf, setDropdowns } from "../../lib/sheets.mjs";

export const ROLES = ["prefer", "neutral", "detect", "official"];
const yt = (h) => `https://www.youtube.com/@${h.replace(/^@/, "")}`;

// One config source -> one Sources row.
export function sourceToRow(s) {
  let link = s.url || "";
  if (s.kind === "youtube") {
    if (s.channelId) link = `https://www.youtube.com/channel/${s.channelId}`;
    else if (s.user) link = `https://www.youtube.com/user/${s.user}`;
    else link = (s.handles || [s.handle]).map(yt).join(" ");
  }
  return { name: s.name, link, role: s.role, language: s.lang === "hi" ? "Hindi" : "English", tag: s.tag || "", status: s.status === "off" ? "off" : "on", notes: s.notes || "" };
}

// One Sources row -> { source } or { error } (a reason the row was skipped, written back to the row).
export function rowToSource(row) {
  const links = String(row.link || "").split(/[\s,]+/).filter(Boolean);
  if (!links.length) return { error: "skipped: no link" };
  const role = String(row.role || "").trim().toLowerCase();
  if (!ROLES.includes(role)) return { error: `skipped: role must be ${ROLES.join(", ")}` };
  const status = String(row.status || "").trim().toLowerCase();
  if (status && status !== "on" && status !== "off") return { error: "skipped: status must be on or off" };
  let urls;
  try {
    urls = links.map((l) => new URL(/^https?:\/\//i.test(l) ? l : `https://${l}`));
  } catch {
    return { error: "skipped: the link is not a web address" };
  }
  const s = { name: String(row.name || "").trim(), role };
  const host = urls[0].hostname.replace(/^(www\.|m\.)/, "");
  if (/(^|\.)youtube\.com$/.test(host)) {
    const parts = urls.map((u) => u.pathname.split("/").filter(Boolean));
    const [first] = parts;
    s.kind = "youtube";
    if (first[0] === "channel" && first[1]) s.channelId = first[1];
    else if (first[0] === "user" && first[1]) s.user = first[1];
    else {
      const handles = parts.map((p) => (p[0]?.startsWith("@") ? p[0].slice(1) : p[0] === "c" ? p[1] : "")).filter(Boolean);
      if (!handles.length) return { error: "skipped: use the channel's link (youtube.com/@name), not a video" };
      if (handles.length > 1) s.handles = handles;
      else s.handle = handles[0];
    }
    s.name ||= s.handle || s.handles?.[0] || s.user || s.channelId;
  } else {
    s.url = /^https?:\/\//i.test(links[0]) ? links[0] : urls[0].href;
    s.kind = /rss|feed|atom|\.xml(\?|$)/i.test(s.url) ? "rss" : "site";
    s.name ||= host;
  }
  if (/^(hi|hindi)$/i.test(String(row.language || "").trim())) s.lang = "hi";
  if (String(row.tag || "").trim()) s.tag = String(row.tag).trim();
  if (status === "off") s.status = "off";
  if (String(row.notes || "").trim()) s.notes = String(row.notes).trim();
  return { source: s };
}

// Returns { sources (the live ones), all (live and off), rows (Sheet rows with their parsed source or error), from,
// warnings, notes }.
// from is "sheet", "seeded" (the tab was empty and has been filled from the copy) or "copy".
export async function loadSources(root, { useSheets }) {
  const copyPath = path.join(root, "config", "sources.json");
  const copy = JSON.parse(await readFile(copyPath, "utf8"));
  const live = (list) => list.filter((s) => s.status !== "off");
  const warnings = [];
  const notes = [];
  if (!useSheets) return { sources: live(copy.sources), rows: [], from: "copy", warnings, notes };
  try {
    await ensureTabs({ Sources: TABS.Sources });
    let rows = (await readRows("Sources")).filter((r) => r.name || r.link);
    if (!rows.length) {
      await writeRows("Sources!A2", copy.sources.map((s) => TABS.Sources.map((h) => sourceToRow(s)[h] ?? "")));
      await setDropdowns("Sources", { role: ROLES, language: ["English", "Hindi"], status: ["on", "off"] });
      rows = await readRows("Sources");
      notes.push(`Sources tab was empty; filled it with the ${copy.sources.length} saved sources`);
    }
    const names = new Set();
    for (const r of rows) {
      Object.assign(r, rowToSource(r));
      if (!r.source) {
        warnings.push(`Sources row ${r._row} (${r.name || r.link}): ${r.error}`);
        continue;
      }
      // Health is matched by name, so names must be unique.
      let name = r.source.name;
      for (let n = 2; names.has(name); n++) name = `${r.source.name} (${n})`;
      if (name !== r.source.name) warnings.push(`Sources row ${r._row}: a second source named "${r.source.name}"; renamed "${name}" for this run`);
      r.source.name = name;
      names.add(name);
    }
    const all = rows.filter((r) => r.source).map((r) => r.source);
    return { sources: live(all), all, rows, from: notes.length ? "seeded" : "sheet", warnings, notes };
  } catch (err) {
    warnings.push(`Sources tab unreadable (${err.message}); used the saved copy in config/sources.json`);
    return { sources: live(copy.sources), rows: [], from: "copy", warnings, notes };
  }
}

// Writes last_checked, items and error into each Sources row.
export async function writeSourceHealth(rows, health, when) {
  if (!rows.length) return;
  const byName = new Map(health.map((h) => [h.source, h]));
  const first = columnOf("Sources", "last_checked");
  const last = columnOf("Sources", "error");
  const end = Math.max(...rows.map((r) => r._row));
  const values = Array.from({ length: end - 1 }, () => ["", "", ""]);
  for (const r of rows) {
    const h = r.source && byName.get(r.source.name);
    values[r._row - 2] = r.error ? [when, "", r.error] : r.source.status === "off" ? [when, "", "off"] : h ? [when, h.ok ? String(h.items) : "", h.ok ? (h.items ? "" : "no recent items") : h.error] : [when, "", ""];
  }
  await writeRows(`Sources!${first}2:${last}${end}`, values);
}

// Saves the Sheet's list (live and switched-off sources) as the fallback copy.
export async function saveCopy(root, all) {
  const copyPath = path.join(root, "config", "sources.json");
  const copy = JSON.parse(await readFile(copyPath, "utf8"));
  copy._readme = "A copy of the Google Sheet's Sources tab, saved by every build. The Sources tab is the master list: edit sources there, not here. This file is used only when the Sheet cannot be read, and to fill the Sources tab if it is empty. role: official = a government body, linked only for its own statement; detect = used only to spot stories, never linked for politics; prefer = linked first wherever it covered a story; neutral = linked for culture, climate and internet stories. lang: hi = Hindi (counts towards hindiMax). status: off = kept but not read.";
  copy.sources = all;
  await writeFile(copyPath, JSON.stringify(copy, null, 2) + "\n");
}
