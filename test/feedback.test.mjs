// The editor's edits as feedback for the next pick, and extra must-not-miss picks beyond the issue's room.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editorFeedback } from "../scripts/lib/feedback.mjs";
import { validatePicks } from "../scripts/lib/picks.mjs";

const edition = {
  date: "2026-11-09",
  lead: { id: "L", url: "https://a.org/lead", headline: "LEAD", original_headline: "Lead story", source: "Zeteo", section: "lead" },
  sections: [
    { key: "picks", title: "Editor's Picks", items: [{ id: "M", url: "https://a.org/mine", headline: "Mine", source: "Jacobin", manual: true, arc: "US populism: DSA vs MAGA" }] },
    { key: "india", title: "India", items: [
      { id: "A", url: "https://a.org/a", headline: "A", original_headline: "Story A", source: "Scroll", arc: "Big business and power" },
      { id: "B", url: "https://a.org/b", headline: "B", original_headline: "Story B", source: "Scroll" },
    ] },
    { key: "ai", title: "AI & Society", items: [{ id: "C", url: "https://a.org/c", headline: "C", original_headline: "Story C", source: "The Deep View", arc: "AI and society" }] },
    { key: "world", title: "World", items: [{ id: "D", url: "https://a.org/d", headline: "D", original_headline: "Story D", source: "BBC World" }] },
  ],
};
const today = [
  { date: "2026-11-09", id: "L", url: "https://a.org/lead", section: "lead", status: "", arc: "" },
  { date: "2026-11-09", id: "A", url: "https://a.org/a", section: "india", status: "hide", arc: "Big business and power", note: "sent it on WhatsApp already" },
  { date: "2026-11-09", id: "B", url: "https://a.org/b", section: "World", status: "", arc: "Youth jobs worldwide", important: "yes" },
  { date: "2026-11-09", id: "C", url: "https://a.org/c", section: "AI & Society", status: "", arc: "AI and society" },
  { date: "2026-11-09", id: "D", url: "https://a.org/d", section: "world", status: "lead", arc: "" },
  { date: "2026-11-09", id: "", url: "https://b.org/new", section: "", my_headline: "My late add", source: "Rest of World", status: "" },
  { date: "2026-11-09", id: "", url: "https://b.org/gone", my_headline: "Hidden add", status: "hide" },
  { date: "2026-11-09", id: "", url: "https://b.org/gone2", my_headline: "Hidden add with reason", source: "Scroll", status: "hide", note: "too old" },
];

test("feedback: hides with their note, moves, promotions, re-tags, important marks and the editor's own links", () => {
  const { text, counts } = editorFeedback([edition], today, [{ date: "2026-11-09", url: "https://a.org/mine" }]);
  assert.deepEqual(counts, { removed: 1, moved: 1, promoted: 1, added: 1, retagged: 1, important: 1, editorLinks: 1, ownHidden: 1, read: 0, desk: 0 });
  assert.match(text, /REMOVED your india pick: "Story A" \(Scroll, arc Big business and power\)\. Editor's note: "sent it on WhatsApp already"/);
  assert.match(text, /MOVED your pick from india to world: "Story B"/);
  assert.match(text, /RE-TAGGED your pick from arc "none" to "Youth jobs worldwide"/);
  assert.match(text, /PROMOTED your world pick to the lead: "Story D"/);
  assert.match(text, /ADDED BY HAND after the build, in Editor's Picks: "My late add" \(Rest of World\)/);
  assert.match(text, /EDITOR'S OWN LINK in picks: "Mine" \(Jacobin, arc US populism: DSA vs MAGA\)\. 1 click\./);
  assert.ok(!/AI & Society|Story C/.test(text.split("\n").filter((l) => l.startsWith("2026")).join("\n")), "a section typed as its title is not a move");
  assert.ok(!/"Hidden add"/.test(text), "a hand-added link hidden without a reason teaches nothing");
  assert.match(text, /HID HIS OWN LINK, added by hand: "Hidden add with reason" \(Scroll\)\. Editor's note: "too old"/);
});

test("feedback: nothing edited gives an empty block", () => {
  const plain = { ...edition, sections: edition.sections.filter((s) => s.key !== "picks") };
  const rows = today.slice(0, 1).concat([{ date: "2026-11-09", id: "A", url: "https://a.org/a", section: "india", arc: "Big business and power" }]);
  assert.deepEqual(editorFeedback([plain], rows), { text: "", counts: { removed: 0, moved: 0, promoted: 0, added: 0, retagged: 0, important: 0, editorLinks: 0, ownHidden: 0, read: 0, desk: 0 } });
});

const settings = { hindiMax: 3, independentPathMax: 4 };
const caps = [{ key: "india", max: 2 }, { key: "world", max: 2 }];
const byCid = new Map(["c1", "c2", "c3", "c4", "c5", "c6"].map((cid) => [cid, { cid, title: cid }]));
const pick = (id, section, extra) => ({ item_id: id, section, path: "consensus", extra });

test("extra picks: only marked must-not-miss stories run past the section maximum and the budget, up to the limit", () => {
  const selection = { picks: [pick("c1", "india"), pick("c2", "india"), pick("c3", "india", true), pick("c4", "world"), pick("c5", "world", true), pick("c6", "world", true)] };
  const out = validatePicks(selection, byCid, settings, caps, 3, false, [], 2);
  assert.deepEqual(out.map((p) => `${p.cid}${p.extra ? "+" : ""}`), ["c1", "c2", "c4", "c3+", "c5+"]);
  const none = validatePicks(selection, byCid, settings, caps, 3, false, [], 0);
  assert.deepEqual(none.map((p) => p.cid), ["c1", "c2", "c4"], "with extraMax 0 the old limits hold");
  const roomy = validatePicks({ picks: [pick("c1", "india", true)] }, byCid, settings, caps, 3, false, [], 2);
  assert.equal(roomy[0].extra, undefined, "an extra mark on a pick that fits is a regular pick");
});

test("feedback: the editor hiding his own Inbox link, with his reason, reaches Claude", () => {
  const rows = today.map((r) => (r.id === "L" ? r : r)).concat([{ date: "2026-11-09", id: "M", url: "https://a.org/mine", section: "picks", status: "hide", note: "doesn't fit the arcs: BJP corruption story" }]);
  const { text, counts } = editorFeedback([edition], rows);
  assert.equal(counts.ownHidden, 2);
  assert.equal(counts.editorLinks, 0);
  assert.match(text, /HID HIS OWN LINK in picks: "Mine" \(Jacobin, arc US populism: DSA vs MAGA\)\. Editor's note: "doesn't fit the arcs: BJP corruption story"/);
});

test("feedback: links the readers had already read are good picks, not rejections", () => {
  const rows = [
    { date: "2026-11-09", id: "A", url: "https://a.org/a", section: "india", status: "read", arc: "Big business and power" },
    { date: "2026-11-09", id: "B", url: "https://a.org/b", section: "india", status: "hide", note: "Discussed" },
    { date: "2026-11-09", id: "M", url: "https://a.org/mine", section: "picks", status: "read" },
    { date: "2026-11-09", id: "", url: "https://b.org/seen", my_headline: "Seen already", status: "read" },
  ];
  const { text, counts } = editorFeedback([edition], rows);
  assert.equal(counts.read, 3);
  assert.equal(counts.removed, 0);
  assert.equal(counts.ownHidden, 0);
  assert.match(text, /ALREADY READ your india pick: "Story A"/);
  assert.match(text, /ALREADY READ your india pick: "Story B" \(Scroll\)\.(\n|$)/);
  assert.ok(!/Editor's note: "Discussed"/.test(text), "a bare read note is not repeated as a lesson");
  assert.match(text, /ALREADY READ, his own link in picks: "Mine"/);
  assert.ok(!/Seen already/.test(text), "a hand-added link they had read teaches nothing");
  assert.match(text, /ALREADY READ: a good pick/);
});

test("feedback: the arc he typed on a hand-added link, and his Desk notes with their reason", () => {
  const rows = [
    { date: "2026-11-09", id: "", url: "https://b.org/x", my_headline: "Maybe a storyline", source: "Compact", arc: "new", note: "MAGA split might deserve its own arc" },
    { date: "2026-11-09", id: "", url: "https://b.org/y", my_headline: "Just useful", source: "Scroll", arc: "none", note: "explains tariffs for Bethia" },
    { date: "2026-11-09", id: "", url: "https://b.org/z", my_headline: "On an arc", source: "PARI", arc: "Youth fighting back" },
  ];
  const desk = [
    { issue_date: "2026-11-09", teaser: "This meme explains SIR in 10 seconds", url: "https://www.instagram.com/p/abc", status: "used 2026-11-09", note: "Watch before the India links", why: "they found SIR confusing on the call" },
    { issue_date: "2026-11-02", teaser: "Older note", url: "", status: "used 2026-11-02" },
    { issue_date: "2026-11-09", teaser: "", url: "", status: "" },
  ];
  const { text, counts } = editorFeedback([edition], rows, [], { deskRows: desk });
  assert.equal(counts.added, 3);
  assert.equal(counts.desk, 1);
  assert.match(text, /"Maybe a storyline" \(Compact, a possible new arc\)\. Editor's note: "MAGA split might deserve its own arc"/);
  assert.match(text, /"Just useful" \(Scroll, outside every arc\)\. Editor's note: "explains tariffs for Bethia"/);
  assert.match(text, /"On an arc" \(PARI, arc Youth fighting back\)/);
  assert.match(text, /DESK NOTE by the editor: "This meme explains SIR in 10 seconds" \(instagram\.com\)\. Line shown under it: "Watch before the India links"\. Why: "they found SIR confusing on the call"/);
  assert.ok(!/Older note/.test(text), "Desk notes of issues outside the window are left out");
});
