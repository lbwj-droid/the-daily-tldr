// The Sources tab: row <-> source conversion, and a full read/seed/health cycle against a fake Google Sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rowToSource, sourceToRow, loadSources, writeSourceHealth, saveCopy } from "../scripts/lib/sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saved = JSON.parse(readFileSync(path.join(root, "config", "sources.json"), "utf8")).sources;
const strip = (s) => Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && k !== "notes"));

test("every saved source survives the trip into a Sheet row and back", () => {
  for (const s of saved) assert.deepEqual(strip(rowToSource(sourceToRow(s)).source), strip(s), s.name);
});

test("links pasted from a phone are understood", () => {
  const src = (link, extra = {}) => rowToSource({ name: "X", link, role: "prefer", ...extra });
  assert.deepEqual(src("https://youtube.com/@peektvofficial?si=73rmR4oeGpTvRfMx").source, { name: "X", role: "prefer", kind: "youtube", handle: "peektvofficial" });
  assert.equal(src("https://m.youtube.com/channel/UCabc").source.channelId, "UCabc");
  assert.equal(src("https://www.youtube.com/user/grihaatul").source.user, "grihaatul");
  assert.equal(src("https://www.thehindu.com/news/national/feeder/default.rss").source.kind, "rss");
  assert.equal(src("aisa.in").source.kind, "site");
  assert.equal(src("https://www.youtube.com/watch?v=abc").error, "skipped: use the channel's link (youtube.com/@name), not a video");
  assert.match(src("https://x.com", { role: "Prefer " }).source.role, /^prefer$/);
  assert.match(rowToSource({ link: "https://x.com", role: "favourite" }).error, /role must be/);
  assert.equal(src("https://x.com", { language: "hindi" }).source.lang, "hi");
  assert.equal(src("https://x.com", { status: "off" }).source.status, "off");
  assert.equal(rowToSource({ link: "https://www.youtube.com/@meghnerd", role: "prefer" }).source.name, "meghnerd", "a missing name falls back to the handle");
});

// A stand-in for the Sheets API and Google's token endpoint, holding one spreadsheet in memory.
function fakeSheet() {
  const tabs = {};
  const writes = [];
  const cellsOf = (range) => {
    const [tab, a1] = decodeURIComponent(range).split("!");
    const m = a1.match(/^([A-Z])(\d+)/);
    return { tab, col: m[1].charCodeAt(0) - 65, row: Number(m[2]) - 1 };
  };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const rest = u.split("/spreadsheets/sheet-1")[1];
    if (rest.startsWith("?fields")) return json({ sheets: Object.keys(tabs).map((title, i) => ({ properties: { title, sheetId: i } })) });
    if (rest.startsWith(":batchUpdate")) {
      for (const r of JSON.parse(opts.body).requests) if (r.addSheet) tabs[r.addSheet.properties.title] = [];
      return json({});
    }
    const range = rest.split("/values/")[1].split(/[?:]/)[0];
    const { tab, col, row } = cellsOf(range);
    if ((opts.method || "GET") === "GET") return json({ values: tabs[tab] });
    if (opts.method === "PUT") {
      const { values } = JSON.parse(opts.body);
      writes.push(decodeURIComponent(range));
      values.forEach((v, i) => {
        const r = (tabs[tab][row + i] ||= []);
        v.forEach((c, j) => (r[col + j] = c));
      });
      return json({});
    }
    return json({});
  };
  process.env.SHEET_ID = "sheet-1";
  process.env.GOOGLE_SA_KEY = "{}";
  process.env.SHEETS_TEST_TOKEN = "t";
  return { tabs, writes };
}

test("an empty Sources tab is filled from the saved copy; health and skipped rows are written back", async () => {
  const realFetch = globalThis.fetch;
  try {
    const sheet = fakeSheet();
    const dir = mkdtempSync(path.join(tmpdir(), "tldr-src-"));
    mkdirSync(path.join(dir, "config"));
    writeFileSync(path.join(dir, "config", "sources.json"), JSON.stringify({ sources: saved.slice(0, 3) }));

    const first = await loadSources(dir, { useSheets: true });
    assert.equal(first.from, "seeded", first.warnings.join("; "));
    assert.equal(sheet.tabs.Sources.length, 4, "heading plus 3 sources");
    assert.equal(first.sources.length, 3);

    // The editor adds a source, switches one off and mistypes a role.
    sheet.tabs.Sources.push(["Peek TV", "https://youtube.com/@peektvofficial?si=x", "prefer", "English", "", "on", ""]);
    sheet.tabs.Sources.push(["Bad row", "https://example.com", "favourite"]);
    sheet.tabs.Sources[2][5] = "off";
    const second = await loadSources(dir, { useSheets: true });
    assert.equal(second.from, "sheet");
    assert.deepEqual(second.sources.map((s) => s.name), [saved[0].name, saved[2].name, "Peek TV"]);
    assert.equal(second.warnings.length, 1);

    const health = [{ source: saved[0].name, ok: true, items: 12 }, { source: saved[2].name, ok: false, error: "HTTP 404" }, { source: "Peek TV", ok: true, items: 0 }];
    await writeSourceHealth(second.rows, health, "2026-11-06 05:15");
    const cells = sheet.tabs.Sources.slice(1).map((r) => r.slice(7, 10));
    assert.deepEqual(cells, [
      ["2026-11-06 05:15", "12", ""],
      ["2026-11-06 05:15", "", "off"],
      ["2026-11-06 05:15", "", "HTTP 404"],
      ["2026-11-06 05:15", "0", "no recent items"],
      ["2026-11-06 05:15", "", "skipped: role must be prefer, neutral, detect, official"],
    ]);

    await saveCopy(dir, second.all);
    const copy = JSON.parse(readFileSync(path.join(dir, "config", "sources.json"), "utf8")).sources;
    assert.equal(copy.length, 4, "the copy keeps switched-off sources");
    assert.equal(copy.find((s) => s.name === saved[1].name).status, "off");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SHEET_ID;
    delete process.env.GOOGLE_SA_KEY;
    delete process.env.SHEETS_TEST_TOKEN;
  }
});

test("if the Sheet cannot be read, the saved copy is used", async () => {
  const realFetch = globalThis.fetch;
  try {
    fakeSheet();
    globalThis.fetch = async () => new Response("nope", { status: 503 });
    const dir = mkdtempSync(path.join(tmpdir(), "tldr-src-"));
    mkdirSync(path.join(dir, "config"));
    writeFileSync(path.join(dir, "config", "sources.json"), JSON.stringify({ sources: [...saved.slice(0, 2), { ...saved[2], status: "off" }] }));
    const list = await loadSources(dir, { useSheets: true });
    assert.equal(list.from, "copy");
    assert.equal(list.sources.length, 2, "switched-off sources stay off");
    assert.match(list.warnings[0], /used the saved copy/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SHEET_ID;
    delete process.env.GOOGLE_SA_KEY;
    delete process.env.SHEETS_TEST_TOKEN;
  }
});
