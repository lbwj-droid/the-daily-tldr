// Checks Claude's picks against the issue's rules: known items only, no paywalls or Shorts, the Hindi cap, the
// independent-path cap, each section's maximum and the issue's link budget.
// extraMax: picks Claude marks `extra` (a story readers must not miss) may run beyond the section maximum and the
// budget, up to this many per issue. The Hindi and independent-path caps still apply to them.
import { matchArc } from "./arcs.mjs";

export function validatePicks(selection, byCid, settings, caps, budget, needLead, arcs = [], extraMax = 0) {
  const used = new Set();
  const out = [];
  let independent = 0;
  let hindi = 0;
  let extras = 0;
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
    const regular = out.filter((o) => !o.isLead && !o.extra).length;
    const full = !isLead && (rank > section.max || regular >= budget);
    const extra = full && p.extra === true && extras < extraMax;
    if (full && !extra) return;
    if (!isLead && p.path === "independent" && !section.focus) independent++;
    if (item.hindi) hindi++;
    if (extra) extras++;
    used.add(item.cid);
    out.push({ ...item, section: p.section, rank: isLead ? 0 : rank, isLead, helpline: p.helpline, story: p.story, path: p.path, arc: matchArc(p.arc, arcs) || undefined, extra: extra || undefined });
  };
  if (needLead && selection.lead) take(selection.lead, true);
  // Sections fill in their listed order (India before World), so a tight budget squeezes the later sections first.
  // Extra picks are considered last, so they never take a regular place.
  const order = (p) => caps.findIndex((s) => s.key === p.section) + (p.extra ? 100 : 0);
  for (const p of [...(selection.picks || [])].sort((a, b) => order(a) - order(b))) take(p, false);
  return out;
}
