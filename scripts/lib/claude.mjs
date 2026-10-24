// The two Claude calls: pick the day's stories, then rewrite their headlines.
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

export async function selectStories({ client, settings, editorial, candidates }) {
  const keys = settings.sections.map((s) => s.key);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["lead", "picks"],
    properties: {
      lead: pickShape(keys),
      picks: { type: "array", items: pickShape(keys), description: "section picks in rank order within each section; never repeats the lead story" },
    },
  };
  const sectionList = settings.sections.map((s) => `- ${s.key} (${s.title}): ${s.quota} stories. Covers ${s.covers}.`).join("\n");
  const system = editorial.replaceAll("{{independentPathMax}}", String(settings.independentPathMax)).replaceAll("{{sectionList}}", sectionList);
  const lines = candidates.map((c) =>
    [c.cid, c.role, c.source + (c.tag ? ` [${c.tag}]` : "") + (c.kind === "video" ? " (video)" : ""), c.published.slice(0, 16), c.paywalled ? "PAYWALLED" : "", c.title, c.summary].join(" | "),
  );
  const user = `Today is ${settings.today} (India time). Here are ${candidates.length} candidate items, one per line:\nid | role | source | published (UTC) | paywall | title | summary\n\n${lines.join("\n")}\n\nApply the editorial rules and return the lead and the section picks.`;
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
  const lines = picks.map((p) => `${p.cid} | ${p.isLead ? "LEAD" : p.section} | ${p.source}${p.kind === "video" ? " (video)" : ""} | ${p.title} | ${p.summary}`);
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
