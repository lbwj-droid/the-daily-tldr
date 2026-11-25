// What the editor did with recent issues, turned into a prompt block for the select step, so each build picks with
// his latest judgement in view. Claude does not remember earlier builds: this block, rebuilt from the Sheet's Today
// tab, the published issues and the Clicks tab every time, is its only memory of his edits.

const clean = (v) => String(v ?? "").trim();
const low = (v) => clean(v).toLowerCase();

// A link the readers had already read or discussed: status "read", or a hide whose note says only that. It leaves the
// page like a hide, but it is not a judgement against the pick.
export const READ_STATUS = "read";
const readNote = (v) => /^(already\s+)?(read|discussed|read\s*(\/|and|&)\s*discussed)\.?$/i.test(clean(v));
export const isRead = (r) => low(r?.status) === READ_STATUS || (low(r?.status) === "hide" && readNote(r?.note));

// The arc the editor typed in Today column N on a link he added: a name, "new" (a possible new arc) or "none".
function arcText(v) {
  const a = clean(v);
  if (!a) return "";
  if (/^new$/i.test(a)) return ", a possible new arc";
  if (/^(none|-)$/i.test(a)) return ", outside every arc";
  return `, arc ${a}`;
}

// editions: recent published issues (not the one being built), newest first. todayRows: the Today tab before this
// build rewrites it. clicks: the Clicks tab. deskRows: the Desk tab. Returns { text, counts }.
export function editorFeedback(editions, todayRows, clicks = [], { maxLines = 40, deskRows = [] } = {}) {
  const lines = [];
  const counts = { removed: 0, moved: 0, promoted: 0, added: 0, retagged: 0, important: 0, editorLinks: 0, ownHidden: 0, read: 0, desk: 0 };
  const clicksOf = (date, url) => clicks.filter((c) => clean(c.date) === date && clean(c.url) === url).length;
  for (const e of editions) {
    const items = [e.lead, ...(e.sections || []).flatMap((s) => (s.items || []).map((i) => ({ ...i, section: i.section || s.key })))].filter(Boolean);
    const rows = todayRows.filter((r) => clean(r.date) === e.date);
    const rowFor = (i) => rows.find((r) => (r.id && clean(r.id) === i.id) || clean(r.url) === i.url);
    // A section typed in the Sheet, as a key: "Editor's Picks" is picks, a section title is its key.
    const keyOf = (v) => {
      const want = low(v).replace(/[^a-z]/g, "");
      if (!want) return "";
      if (want === "lead") return "lead";
      if (want.startsWith("editor") || want === "pick") return "picks";
      return (e.sections || []).find((s) => s.key === want || low(s.title).replace(/[^a-z]/g, "") === want)?.key || want;
    };
    const why = (r) => (clean(r?.note) && !readNote(r.note) ? ` Editor's note: "${clean(r.note)}".` : "");
    const tag = (i) => `"${i.original_headline || i.headline}" (${i.source || "?"}${i.arc ? `, arc ${i.arc}` : ""}${i.extra ? ", extra" : ""})`;
    for (const i of items.filter((x) => !x.primer)) {
      const r = rowFor(i);
      const c = clicksOf(e.date, i.url);
      const clickText = c ? ` ${c} click${c > 1 ? "s" : ""}.` : "";
      if (i.manual) {
        const where = i.section === "lead" ? "the lead" : i.section;
        if (isRead(r)) {
          counts.read++;
          lines.push(`${e.date} ALREADY READ, his own link in ${where}: ${tag(i)}.${why(r)}${clickText}`);
        } else if (low(r?.status) === "hide") {
          counts.ownHidden++;
          lines.push(`${e.date} HID HIS OWN LINK in ${where}: ${tag(i)}.${why(r)}`);
        } else {
          counts.editorLinks++;
          lines.push(`${e.date} EDITOR'S OWN LINK in ${where}: ${tag(i)}.${why(r)}${clickText}`);
        }
        continue;
      }
      if (!r) continue;
      const status = low(r.status);
      if (isRead(r)) {
        counts.read++;
        lines.push(`${e.date} ALREADY READ your ${i.section === "lead" ? "lead" : `${i.section} pick`}: ${tag(i)}.${why(r)}${clickText}`);
        continue;
      }
      if (status === "hide") {
        counts.removed++;
        lines.push(`${e.date} REMOVED your ${i.section === "lead" ? "lead" : `${i.section} pick`}: ${tag(i)}.${why(r)}`);
        continue;
      }
      if (status === "lead" && i.section !== "lead") {
        counts.promoted++;
        lines.push(`${e.date} PROMOTED your ${i.section} pick to the lead: ${tag(i)}.${why(r)}${clickText}`);
      }
      const moved = keyOf(r.section);
      if (moved && moved !== "lead" && moved !== i.section && i.section !== "lead") {
        counts.moved++;
        lines.push(`${e.date} MOVED your pick from ${i.section} to ${moved}: ${tag(i)}.${why(r)}`);
      }
      if ("arc" in r && clean(r.arc) !== clean(i.arc || "")) {
        counts.retagged++;
        lines.push(`${e.date} RE-TAGGED your pick from arc "${i.arc || "none"}" to "${clean(r.arc) || "none"}": ${tag(i)}.`);
      }
      if (/^(y|yes|true|1|x)$/i.test(clean(r.important))) {
        counts.important++;
        lines.push(`${e.date} MARKED IMPORTANT: ${tag(i)}.${clickText}`);
      }
    }
    // Rows typed into Today after the build: links he added to a published issue.
    for (const r of rows) {
      if (!/^https?:\/\//.test(clean(r.url)) || !clean(r.my_headline)) continue;
      if (items.some((i) => (r.id && clean(r.id) === i.id) || clean(r.url) === i.url)) continue;
      // A link he added that the readers had already read: nothing to learn beyond the link itself.
      if (isRead(r)) continue;
      // A link he added and then hid teaches something only when he said why.
      if (low(r.status) === "hide") {
        if (!clean(r.note)) continue;
        counts.ownHidden++;
        lines.push(`${e.date} HID HIS OWN LINK, added by hand: "${clean(r.my_headline)}" (${clean(r.source) || new URL(clean(r.url)).hostname}${arcText(r.arc)}).${why(r)}`);
        continue;
      }
      counts.added++;
      lines.push(`${e.date} ADDED BY HAND after the build, in ${low(r.section) || "Editor's Picks"}: "${clean(r.my_headline)}" (${clean(r.source) || new URL(clean(r.url)).hostname}${arcText(r.arc)}).${why(r)}`);
    }
    // His Desk notes for this issue: clips, memes and short notes he put above the links, with his reason (column F).
    for (const d of deskRows.filter((x) => clean(x.issue_date) === e.date && (clean(x.teaser) || /^https?:\/\//.test(clean(x.url))))) {
      counts.desk++;
      let host = "";
      try { host = clean(d.url) ? ` (${new URL(clean(d.url)).hostname.replace(/^www\./, "")})` : ""; } catch { host = ""; }
      const shown = clean(d.note) ? ` Line shown under it: "${clean(d.note)}".` : "";
      const reason = clean(d.why) ? ` Why: "${clean(d.why)}".` : "";
      lines.push(`${e.date} DESK NOTE by the editor: "${clean(d.teaser) || clean(d.url)}"${host}.${shown}${reason}`);
    }
  }
  if (!lines.length) return { text: "", counts };
  const kept = lines.slice(0, maxLines);
  const text = `

## The editor's recent edits

What the editor did with the last ${editions.length} issues, newest first. Learn his judgement from it, but do not over-read a single edit: he may remove a good story because he already sent it to the readers, or because it ran in an earlier issue.

- REMOVED: he judged your pick wrong for this page. Avoid similar picks (same kind of story, angle or source) unless his note says otherwise.
- PROMOTED, MARKED IMPORTANT: picks he valued most. Look for more like them.
- MOVED, RE-TAGGED: you had the right story in the wrong section or arc.
- ADDED BY HAND and EDITOR'S OWN LINK: stories he wanted. They show the topics, angles and sources he values; never pick the same story again.
- HID HIS OWN LINK: he changed his mind about a link he chose. His note is the lesson, often a rule about what belongs on the page or in an arc; apply it to your own picks.
- ALREADY READ: a good pick he took off the page because the readers had already read or discussed it with him. Not a mistake; do not avoid similar stories, and do not pick the same story again.
- DESK NOTE: a clip, meme or short note he put above the links to help the readers follow a story or arc. It shows what he thinks they need explained; prefer picks that build on it.
- "A possible new arc" and "outside every arc" on his links: he is testing a storyline, or wanted a story that fits no arc. Treat them as hints about what deserves room.
- Clicks show what the readers opened; a few readers, so treat them as hints.

${kept.join("\n")}${lines.length > kept.length ? `\n(${lines.length - kept.length} older edits left out.)` : ""}`;
  return { text, counts };
}
