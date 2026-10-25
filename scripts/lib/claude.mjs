// The Claude calls: pick the issue's stories, rewrite their headlines, then fact-check the rewrites.
import Anthropic from "@anthropic-ai/sdk";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

async function askJson(client, { model, effort, system, user, schema }) {
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    // If a safety classifier declines the request, the API re-runs it on Anthropic's recommended fallback model.
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error(`Claude declined: ${JSON.stringify(msg.stop_details)}`);
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens");
  const textOut = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(textOut), usage: msg.usage, model: msg.model };
}

const pickShape = (sectionKeys) => ({
  type: "object",
  additionalProperties: false,
  required: ["item_id", "section", "story", "path", "helpline"],
  properties: {
    item_id: { type: "string", description: "id of the single candidate item to link to" },
    section: { type: "string", enum: sectionKeys },
    story: { type: "string", description: "five to ten words naming the story" },
    path: { type: "string", enum: ["consensus", "independent", "neutral"] },
    helpline: { type: "boolean", description: "true only for kept suicide-related items" },
  },
});

// sections: [{key, title, max, covers}] with max already reduced by the editor's own links in that section.
// budget: total links Claude may pick across all sections (the lead not included). needLead: false when the editor set the lead.
export async function selectStories({ client, settings, editorial, candidates, sections, budget, needLead, manual, windowText }) {
  const keys = sections.map((s) => s.key);
  const picksSchema = { type: "array", items: pickShape(keys), description: "section picks in rank order within each section; never repeats the lead story" };
  const schema = needLead
    ? { type: "object", additionalProperties: false, required: ["lead", "picks"], properties: { lead: pickShape(keys), picks: picksSchema } }
    : { type: "object", additionalProperties: false, required: ["picks"], properties: { picks: picksSchema } };
  const sectionList = [
    `This issue has room for ${budget} section links in total${needLead ? ", plus the lead" : " (the editor has chosen the lead himself, so do not pick one)"}. Spread them across the sections below in the order listed, each up to its maximum. Fewer strong links beat a full page of weak ones.`,
    ...sections.map((s) => `- ${s.key} (${s.title}): up to ${s.max}. Covers ${s.covers}.`),
  ].join("\n");
  const system = editorial.replaceAll("{{independentPathMax}}", String(settings.independentPathMax)).replaceAll("{{sectionList}}", sectionList);
  const flags = (c) =>
    [c.paywalled && "PAYWALLED", c.focusOnly && "FOCUS-ONLY", c.hindi && "HINDI", c.kind === "video" && `VIDEO ${c.seconds ? Math.round(c.seconds / 60) + "m" : "?m"}`].filter(Boolean).join(" ");
  const lines = candidates.map((c) => [c.cid, c.role, c.source + (c.tag ? ` [${c.tag}]` : ""), c.published.slice(0, 16), flags(c), c.title, c.summary].join(" | "));
  const manualNote = manual.length
    ? `\n\nThe editor has already placed these links in this issue. Do not pick the same stories again:\n${manual.map((m) => `- ${m.title || m.url}`).join("\n")}`
    : "";
  const user =
    `This issue is dated ${settings.today} (Dubai time) and covers ${windowText}. Here are ${candidates.length} candidate items, one per line:\n` +
    `id | role | source | published (UTC) | flags | title | summary\n\n${lines.join("\n")}${manualNote}\n\n` +
    `At most ${settings.hindiMax} picks in total may be flagged HINDI. Prefer videos of ${settings.preferVideoMinutes} minutes or less.\n\n` +
    `Apply the editorial rules and return ${needLead ? "the lead and " : ""}the section picks.`;
  return askJson(client, { model: settings.model, effort: settings.effort, system, user, schema });
}

export async function rewriteHeadlines({ client, settings, voice, styleExamples, picks }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["headlines"],
    properties: {
      headlines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_id", "headline"],
          properties: { item_id: { type: "string" }, headline: { type: "string" } },
        },
      },
    },
  };
  let system = voice;
  if (styleExamples.length) {
    system +=
      "\n\n## Corrections from the editor (most recent first, these override the starter examples)\n\n| Original | Claude wrote | Editor rewrote it as |\n| --- | --- | --- |\n" +
      styleExamples.map((e) => `| ${e.original_headline} | ${e.ai_headline} | ${e.my_headline} |`).join("\n");
  }
  const lines = picks.map((p) => `${p.cid} | ${p.isLead ? "LEAD" : p.section} | ${p.source}${p.kind === "video" ? " (video)" : ""} | ${p.title} | ${p.summary || ""}`);
  const user = `Rewrite these ${picks.length} headlines. One line per item:\nid | section | source | original headline | summary\n\n${lines.join("\n")}`;
  return askJson(client, { model: settings.model, effort: settings.effort, system, user, schema });
}

// Checks each rewrite against its source text; anything unsupported falls back to the original headline.
export async function verifyHeadlines({ client, settings, pairs }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_id", "supported", "problem"],
          properties: { item_id: { type: "string" }, supported: { type: "boolean" }, problem: { type: "string" } },
        },
      },
    },
  };
  const system =
    "You are a fact-checker for a news headline board. For each item, decide whether every factual claim in the REWRITE is supported by the ORIGINAL headline or the SUMMARY. " +
    "Jokes, tone, slang and rhetorical questions are fine. Unsupported: added numbers, names, places, dates, causes, motives or events; a changed meaning; a claim stated as fact that the source only reports as an allegation. " +
    "Set supported=false and name the problem in a few words when anything is unsupported; otherwise supported=true and problem empty.";
  const user = pairs
    .map((p) => `ID: ${p.cid}\nORIGINAL: ${p.title}\nSUMMARY: ${p.summary || "(none)"}\nREWRITE: ${p.headline}`)
    .join("\n\n");
  return askJson(client, { model: settings.model, effort: "low", system, user, schema });
}

export function makeClient() {
  return new Anthropic();
}
