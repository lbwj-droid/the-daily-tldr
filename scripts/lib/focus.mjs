// Focus topics: dated showcase sections layered on top of the regular page (see config/focus.json).
import { readFile } from "node:fs/promises";
import path from "node:path";

const dayNumber = (today, start) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400e3) + 1;

// Returns the focuses live today, each with its brief text and "day n of N".
export async function loadFocus(root, today, configPath = path.join(root, "config", "focus.json")) {
  const config = await readFile(configPath, "utf8").then(JSON.parse).catch(() => ({ focuses: [] }));
  const active = [];
  for (const f of config.focuses || []) {
    const day = dayNumber(today, f.start);
    if (!f.enabled || day < 1 || day > f.days) continue;
    const brief = await readFile(path.resolve(root, f.brief), "utf8");
    const words = (f.keywords || []).map((k) => k.toLowerCase());
    active.push({ ...f, day, briefText: brief, matches: (item) => words.some((w) => `${item.title} ${item.summary}`.toLowerCase().includes(w)) });
  }
  return { active, regularQuotas: config.regularQuotasWhenFocused || {} };
}

// Focus sections go first, ahead of the regular sections; the issue-wide link budget squeezes everything else.
export function effectiveSections(regular, focus) {
  const focusSections = focus.active.map((f) => ({
    key: f.key,
    title: f.title,
    max: f.maxLinks,
    covers: `the "${f.title}" focus topic, as defined in its brief below`,
    focus: true,
    day: f.day,
    days: f.days,
  }));
  return [...focusSections, ...regular];
}

export function focusPromptBlock(focus, settings) {
  if (!focus.active.length) return "";
  return [
    "\n\n## Focus topics (live now)\n",
    "These sections are the editor's showcase for this period. Fill them first, then the regular sections.",
    "A story appears in one section only: a story that fits a focus goes in the focus section, not in India or World. The lead may come from a focus.",
    `Each focus section takes up to its stated number of links; give fewer on quiet weeks rather than padding it. Items marked FOCUS-ONLY are older than this issue's window and may be used only in focus sections.`,
    "Where a focus brief sets a rule that differs from the general rules above, the brief wins for that section only. The Leave out rules always apply.\n",
    ...focus.active.map((f) => `### ${f.title} (section key: ${f.key}, up to ${f.maxLinks} links, day ${f.day} of ${f.days} of the focus period)\n\n${f.briefText.trim()}\n`),
  ].join("\n");
}

export function focusToneBlock(focus) {
  if (!focus.active.length) return "";
  return (
    "\n\n## Focus sections\n\nItems in these sections follow the tone rules in their brief, which override the rules above for those items only.\n\n" +
    focus.active.map((f) => `### ${f.title} (section ${f.key})\n\n${f.briefText.trim()}`).join("\n\n")
  );
}
