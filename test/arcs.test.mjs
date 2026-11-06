// Story arcs pilot: the Arcs tab, recap timing, the per-arc report, the questions endpoint, and dry-run issues.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArcs, matchArc, recapDue, arcReport, NEW_ARC } from "../scripts/lib/arcs.mjs";
import { questionRow } from "../api/question.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allItems = (e) => [e.lead, ...e.sections.flatMap((s) => s.items)].filter(Boolean);
const rows = (list) => list.map((r, n) => ({ ...r, _row: n + 2 }));

function dryRun({ date = "2026-10-30", inbox = {}, out = mkdtempSync(path.join(tmpdir(), "tldr-arcs-")) } = {}) {
  execFileSync("node", [path.join(root, "test", "make-fixtures.mjs")]);
  writeFileSync(path.join(out, "inbox.json"), JSON.stringify({ inbox: [], desk: [], ...inbox }));
  execFileSync("node", [path.join(root, "scripts", "build-edition.mjs"), "--dry-run", "--out", out, "--inbox", path.join(out, "inbox.json")], { env: { ...process.env, EDITION_DATE: date } });
  return {
    out,
    edition: JSON.parse(readFileSync(path.join(out, "editions", `${date}.json`), "utf8")),
    index: JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")),
    report: JSON.parse(readFileSync(path.join(out, "last-run.json"), "utf8")),
  };
}

const ARCS = [
  { arc: "Data bill", side: "india", status: "", so_far: "Parliament is debating a bill on personal data." },
  { arc: "Ceasefire talks", side: "World", status: "active", so_far: "Negotiators keep meeting in Geneva." },
  { arc: "Old story", side: "india", status: "closed" },
];

test("Arcs tab: blank status is active; watch and closed are known but not sent to Claude; bad rows are named", () => {
  const { active, known, warnings } = parseArcs(
    rows([
      { arc: "Exams", status: "" },
      { arc: "Tariffs", status: "Watch", side: "w" },
      { arc: "Old", status: "closed" },
      { arc: "exams", status: "active" },
      { arc: "new", status: "active" },
      { arc: "Typo", status: "paused" },
      { arc: "" },
      { arc: "Third", status: "active" },
    ]),
    2,
  );
  assert.deepEqual(active.map((a) => a.name), ["Exams", "Third"]);
  assert.deepEqual(known.map((a) => a.name), ["Exams", "Tariffs", "Old", "Third"]);
  assert.equal(known[1].side, "world");
  assert.equal(warnings.length, 3, warnings.join("; "));
  const tooMany = parseArcs(rows([{ arc: "A" }, { arc: "B" }, { arc: "C" }]), 2);
  assert.equal(tooMany.active.length, 2);
  assert.match(tooMany.warnings[0], /more than 2 active arcs/);
});

test("arc names match without regard to case; none and unknown names give no arc", () => {
  const { known } = parseArcs(rows([{ arc: "Exams" }]));
  assert.equal(matchArc(" exams ", known), "Exams");
  assert.equal(matchArc("New story to watch", known), NEW_ARC);
  assert.equal(matchArc("none", known), "");
  assert.equal(matchArc("Something else", known), "");
});

test("the recap runs on every 4th issue counted from the first issue with arcs", () => {
  assert.deepEqual([4, 5, 6, 7, 8, 9, 12].map((n) => recapDue(n, 5, 4)), [false, false, false, false, true, false, true]);
  assert.equal(recapDue(8, null, 4), false, "no arcs yet, no recap");
});

test("the arc report counts links, clicks on arc links and other links, and questions, within the period", () => {
  const editions = [
    { date: "2026-11-09", lead: { url: "https://a.org/1", headline: "A1", arc: "Exams" }, sections: [{ items: [{ url: "https://a.org/2", headline: "B", arc: NEW_ARC }, { url: "https://a.org/3", headline: "C" }] }] },
    { date: "2026-11-13", lead: null, sections: [{ items: [{ url: "https://a.org/4", headline: "A2", arc: "Exams" }] }] },
  ];
  const clicks = [
    { date: "2026-11-09", url: "https://a.org/1" },
    { date: "2026-11-09", url: "https://a.org/3" },
    { date: "2026-11-13", url: "https://a.org/4" },
    { date: "2026-11-02", url: "https://a.org/1" },
  ];
  const r = arcReport([{ name: "Exams", status: "active" }, { name: "Tariffs", status: "watch" }], editions, clicks, [{ date: "2026-11-13" }, { date: "2026-11-02" }]);
  assert.deepEqual(r.arcs, [
    { arc: "Exams", status: "active", links: 2, clicks: 2, last_link: "2026-11-13" },
    { arc: "Tariffs", status: "watch", links: 0, clicks: 0, last_link: "" },
  ]);
  assert.deepEqual(r.links, { total: 4, withArc: 2 });
  assert.deepEqual(r.clicks, { total: 3, onArcLinks: 2, onOtherLinks: 1 });
  assert.equal(r.questions, 1);
});

test("questions: a usable question becomes a Questions row; empty or link-less ones are refused", () => {
  const row = questionRow({ r: "Raph!", date: "2026-11-09", section: "india", headline: "H", url: "https://a.org/x", question: "  Why   now? " }, new Date("2026-11-09T04:00:00Z"));
  assert.deepEqual(row, { timestamp: "2026-11-09T04:00:00.000Z", reader: "raph", date: "2026-11-09", section: "india", headline: "H", url: "https://a.org/x", question: "Why now?", status: "" });
  assert.equal(questionRow({ url: "https://a.org/x", question: " " }), null);
  assert.equal(questionRow({ url: "javascript:alert(1)", question: "Why?" }), null);
  assert.equal(questionRow({ url: "https://a.org/x", question: "=HYPERLINK(1)" }).question, "'=HYPERLINK(1)");
  assert.equal(questionRow({ url: "https://a.org/x", question: "x".repeat(900) }).question.length, 500);
});

test("with no arcs in the Sheet the issue carries no arc labels and no recap", () => {
  const { edition, index } = dryRun();
  assert.ok(!allItems(edition).some((i) => i.arc));
  assert.equal(edition.arcs, undefined);
  assert.equal(edition.recap, undefined);
  assert.equal(index.arcsSince, undefined);
});

test("with arcs, links carry their arc; the editor's typed arc wins; the first arc issue is remembered", () => {
  const inbox = {
    arcs: ARCS,
    inbox: [
      { url: "https://news.example.com/mine", my_headline: "My data link", arc: "DATA bill" },
      { url: "https://news.example.com/typo", my_headline: "Typo arc", arc: "Data bil" },
    ],
  };
  const { edition, index, report } = dryRun({ inbox });
  const items = allItems(edition);
  assert.ok(items.some((i) => i.arc === "Data bill" && !i.manual), "Claude's stand-in tags a data bill story");
  assert.ok(items.some((i) => !i.arc), "stories outside every arc carry none");
  assert.equal(items.find((i) => i.headline === "My data link").arc, "Data bill");
  assert.equal(items.find((i) => i.headline === "Typo arc").arc, undefined);
  assert.ok(report.warnings.some((w) => /arc "Data bil" is not in the Arcs tab/.test(w)));
  assert.deepEqual(edition.arcs.map((a) => a.name), ["Data bill", "Ceasefire talks"], "closed arcs are not listed");
  assert.equal(edition.arcs[0].so_far, "Parliament is debating a bill on personal data.");
  assert.equal(index.arcsSince, 1);
  assert.equal(edition.recap, undefined, "the first arc issue has no recap");
  assert.equal(report.arcReport.arcs[0].links, items.filter((i) => i.arc === "Data bill").length);
});

test("the 4th issue with arcs carries a recap of the arc links of the last 4 issues, with a recall question", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tldr-recap-"));
  mkdirSync(path.join(out, "editions"));
  const old = ["2026-10-19", "2026-10-23", "2026-10-26"];
  old.forEach((d, n) => {
    const item = { id: `x${n}`, url: `https://example.org/old${n}`, headline: `Old ceasefire step ${n + 1}`, original_headline: `Ceasefire step ${n + 1}`, source: "BBC World", arc: "Ceasefire talks" };
    writeFileSync(path.join(out, "editions", `${d}.json`), JSON.stringify({ date: d, issue: n + 1, lead: null, sections: [{ key: "world", items: [item] }] }));
  });
  writeFileSync(path.join(out, "index.json"), JSON.stringify({ lastIssue: 3, arcsSince: 1, editions: old.map((d, n) => ({ date: d, issue: n + 1 })) }));
  const { edition, report } = dryRun({ out, inbox: { arcs: ARCS, clicks: [{ date: "2026-10-23", url: "https://example.org/old1" }] } });
  assert.equal(edition.issue, 4);
  assert.deepEqual(edition.recap.issues, [...old, "2026-10-30"]);
  const ceasefire = edition.recap.arcs.find((r) => r.arc === "Ceasefire talks");
  assert.match(ceasefire.changed, /Ceasefire step 1; Ceasefire step 2; Ceasefire step 3/);
  assert.ok(ceasefire.question && ceasefire.answer);
  assert.equal(report.arcReport.arcs.find((a) => a.arc === "Ceasefire talks").clicks, 1);
});

test("the starting arcs fit the Arcs tab rules: 7 active, names of 40 characters or fewer, no duplicates", () => {
  const seed = JSON.parse(readFileSync(path.join(root, "config", "arcs-seed.json"), "utf8"));
  const { active, warnings } = parseArcs(rows(seed.arcs));
  assert.equal(warnings.length, 0, warnings.join("; "));
  assert.equal(active.length, 7);
  for (const a of seed.arcs) assert.ok(!/—/.test(a.so_far), `${a.arc}: no em dash`);
});
