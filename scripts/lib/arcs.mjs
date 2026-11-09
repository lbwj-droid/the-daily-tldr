// Story arcs: the running storylines (Sheet Arcs tab) that every link is attached to, the fortnightly recap, and the
// per-arc report the editor reviews at each recap.

// Arc value Claude uses for a possible new storyline; shown as "New story to watch".
export const NEW_ARC = "new";
export const NEW_ARC_LABEL = "New story to watch";

const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const sameName = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// Reads the Arcs tab rows. Active arcs (status "active", or blank) go to Claude; watch and closed arcs are kept as
// known names so a link can still carry one the editor typed. At most settings.arcs.maxActive active arcs.
export function parseArcs(rows, max = 8) {
  const warnings = [];
  const active = [];
  const known = [];
  for (const r of rows || []) {
    const name = clean(r.arc);
    if (!name) continue;
    if (name.length > 40) {
      warnings.push(`Arcs row ${r._row}: arc name longer than 40 characters; skipped`);
      continue;
    }
    if (sameName(name, NEW_ARC) || known.some((k) => sameName(k.name, name))) {
      warnings.push(`Arcs row ${r._row}: "${name}" is ${sameName(name, NEW_ARC) ? "reserved" : "a duplicate"}; skipped`);
      continue;
    }
    const status = clean(r.status).toLowerCase() || "active";
    if (!["active", "watch", "closed"].includes(status)) {
      warnings.push(`Arcs row ${r._row}: status "${r.status}" is not active, watch or closed; skipped`);
      continue;
    }
    const side = /^w/i.test(clean(r.side)) ? "world" : /^i/i.test(clean(r.side)) ? "india" : "";
    const primer = /^https?:\/\//.test(clean(r.primer)) ? clean(r.primer) : "";
    if (clean(r.primer) && !primer) warnings.push(`Arcs row ${r._row}: primer "${clean(r.primer)}" is not a link; left out`);
    const arc = { name, side, status, so_far: clean(r.so_far), primer, primer_headline: clean(r.primer_headline), _row: r._row };
    known.push(arc);
    if (status === "active") {
      if (active.length >= max) warnings.push(`Arcs row ${r._row}: more than ${max} active arcs; "${name}" left out until one is moved to watch`);
      else active.push(arc);
    }
  }
  return { active, known, warnings };
}

// The arc name as the Arcs tab spells it, NEW_ARC, or "" for none.
export function matchArc(value, known) {
  const v = clean(value);
  if (!v || /^(none|-)$/i.test(v)) return "";
  if (sameName(v, NEW_ARC) || sameName(v, NEW_ARC_LABEL)) return NEW_ARC;
  return known.find((a) => sameName(a.name, v))?.name || "";
}

// Recaps run on every `every`-th issue counted from the first issue built with arcs (arcsSince), so the first recap
// is the 4th arc issue.
export function recapDue(issue, arcsSince, every = 4) {
  if (!arcsSince || !every || issue < arcsSince) return false;
  return (issue - arcsSince + 1) % every === 0;
}

// Arc links over a set of issues: [{arc, date, headline, original, source, url}], oldest first.
export function arcLinks(editions) {
  const out = [];
  for (const e of [...editions].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const i of [e.lead, ...(e.sections || []).flatMap((s) => s.items || [])]) {
      if (!i?.arc || i.arc === NEW_ARC || i.primer) continue;
      out.push({ arc: i.arc, date: e.date, headline: i.headline, original: i.original_headline || i.headline, source: i.source, url: i.url });
    }
  }
  return out;
}

// Per-arc counts for the editor: links and clicks over the given issues, and the last date a link ran. Clicks are
// matched by url and issue date; preview clicks count too (the Clicks tab cannot tell them apart).
export function arcReport(arcs, editions, clicks, questions = []) {
  const links = arcLinks(editions);
  const dates = new Set(editions.map((e) => e.date));
  const arcOfLink = new Map(links.map((l) => [`${l.date} ${l.url}`, l.arc]));
  const rows = arcs.map((a) => {
    const mine = links.filter((l) => l.arc === a.name);
    return {
      arc: a.name,
      status: a.status,
      links: mine.length,
      clicks: (clicks || []).filter((c) => arcOfLink.get(`${c.date} ${clean(c.url)}`) === a.name).length,
      last_link: mine.length ? mine[mine.length - 1].date : "",
    };
  });
  const inWindow = (r) => dates.has(clean(r.date));
  // Primer clicks (the "Start here" link or the one behind an arc label) are counted on their own.
  const primerUrls = new Set(arcs.map((a) => a.primer).filter(Boolean));
  const isPrimer = (c) => clean(c.section) === "primer" || primerUrls.has(clean(c.url));
  const allClicks = (clicks || []).filter(inWindow);
  const primerClicks = allClicks.filter(isPrimer).length;
  const arcClicks = allClicks.filter((c) => !isPrimer(c) && arcOfLink.has(`${c.date} ${clean(c.url)}`)).length;
  const allLinks = editions.reduce((n, e) => n + [e.lead, ...(e.sections || []).flatMap((s) => s.items || [])].filter(Boolean).length, 0);
  return {
    issues: editions.map((e) => e.date).sort(),
    arcs: rows,
    links: { total: allLinks, withArc: links.length },
    clicks: { total: allClicks.length, onArcLinks: arcClicks, onPrimers: primerClicks, onOtherLinks: allClicks.length - arcClicks - primerClicks },
    questions: (questions || []).filter(inWindow).length,
  };
}

// Offline stand-in for the recap call: one line per arc listing its headlines.
export function heuristicRecap(arcs, links) {
  return {
    arcs: arcs
      .map((a) => ({ arc: a.name, items: links.filter((l) => l.arc === a.name) }))
      .filter((x) => x.items.length)
      .map((x) => ({
        arc: x.arc,
        changed: `In the last two weeks: ${x.items.map((i) => i.original).join("; ")}.`,
        question: `What was the latest development in "${x.arc}"?`,
        answer: x.items[x.items.length - 1].original,
      })),
  };
}

// The prompt block that tells the select step about the arcs.
export function arcsPromptBlock(arcs, maxOffArc) {
  if (!arcs.length) return "";
  const list = arcs.map((a) => `- ${a.name}${a.side ? ` (${a.side})` : ""}: ${a.so_far || "no summary yet"}`).join("\n");
  return `

## Story arcs

The editor follows these running storylines. The aim is that every new headline lands on a story the readers already know, so over weeks they come to understand a handful of big stories well.

${list}

For every pick (and the lead), set \`arc\` to the one arc the item moves forward: it reports a new development, decision, number or interview on that storyline. A story that only mentions a related subject does not belong to the arc. Among stories that qualify, prefer those that move an active arc forward, but never pick a weak item only because it fits an arc.

The arcs overlap (education, jobs, inequality and protest are one knot). When an item ties several arcs together in one comprehensive analysis, prefer it to a piece on one arc, and tag it with the arc it moves furthest. Otherwise pick the most potent, dramatic new development within one arc.

Set \`arc\` to "none" for a story outside every arc. Never leave out the period's big story because it fits no arc: use your judgement, and keep such picks to the stories everyone will talk about (usually ${maxOffArc} or fewer an issue). Set \`arc\` to "${NEW_ARC}" for at most one pick that looks like the start of a storyline the editor should consider adding: it must be likely to run for weeks.

Also tag each of the editor's own links listed below with its arc, or "none".`;
}
