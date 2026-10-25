// Writes made-up feeds into test/fixtures so the pipeline can be dry-run offline.
// Every story here is fictional; it exists only to exercise parsing, selection and layout.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shortId } from "../scripts/lib/feeds.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const now = Date.now();
const iso = (h) => new Date(now - h * 3600e3).toISOString();
const rfc = (h) => new Date(now - h * 3600e3).toUTCString();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const rss = (items) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture</title>${items
    .map(
      ([t, d, h], n) =>
        `<item><title><![CDATA[${t}]]></title><link>https://example.org/story/${shortId(t)}</link><description>${esc(`<p>${d}</p>`)}</description><pubDate>${rfc(h)}</pubDate>${
          n === 0 ? `<media:thumbnail url="https://picsum.photos/seed/${shortId(t)}/800/450"/>` : ""
        }</item>`,
    )
    .join("")}</channel></rss>`;

const youtube = (items) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>Fixture channel</title>${items
    .map(
      ([t, d, h]) =>
        `<entry><yt:videoId>${shortId(t).slice(0, 11)}</yt:videoId><title>${esc(t)}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${shortId(t).slice(0, 11)}"/><published>${iso(h)}</published><media:group><media:title>${esc(t)}</media:title><media:description>${esc(d)}</media:description></media:group></entry>`,
    )
    .join("")}</feed>`;

const F = {
  "BBC World": rss([["Ceasefire talks resume in Geneva", "Negotiators return after a two-week pause.", 3], ["Heatwave grips southern Europe", "Temperatures pass 44C in Seville.", 5]]),
  "BBC India": rss([["India's monsoon session opens with data bill on agenda", "The bill is expected to face opposition.", 4]]),
  "Al Jazeera": rss([["Ceasefire talks resume in Geneva as aid convoys wait", "Aid groups say trucks are stuck at the border.", 2], ["Climate summit host names new finance target", "Rich nations asked to triple funds.", 7]]),
  "The Hindu": rss([["Opposition walks out over data bill in Lok Sabha", "Members demanded referral to a committee.", 3]]),
  NDTV: rss([["Data bill: opposition stages walkout", "Walkout in the lower house.", 2]]),
  "Faye D'Souza (Beatroot News)": youtube([["What the new data bill means for your phone", "Faye explains the data bill in 5 minutes.", 2]]),
  "Dhruv Rathee": youtube([["The truth about the data protection bill", "Analysis of the bill and its exemptions.", 6], ["Why are exam papers leaking again?", "A look at the paper leak pattern.", 20]]),
  "Mojo Story": youtube([["Women commuters on the night-bus safety pilot", "Ground report on a city's new night-bus marshals.", 8]]),
  "Indian National Congress": youtube([["Press conference on the data bill", "Party leaders address the media.", 5]]),
  Scroll: rss([["Inside the exam paper leak racket", "Investigation into how papers reach Telegram groups.", 9], ["Delhi's air: the winter plan nobody followed", "Officials missed four deadlines.", 12], ["University students begin hunger strike over fee hike", "Students say fees rose 300%.", 5]]),
  "Alt News": rss([["Fact check: viral video of flooded metro is from 2019", "The clip is old and from another city.", 4]]),
  "Breaking Points": youtube([["Krystal and Saagar react to the Geneva talks", "Full segment on the ceasefire talks.", 6]]),
  Zeteo: rss([["The ceasefire deal nobody in Washington wants to explain", "Op-ed on the talks.", 10], ["Tanker traffic through Hormuz slows as insurers raise premiums", "Shipping data shows fewer transits.", 6]]),
  "Drop Site News": rss([["Leaked memo shows aid convoy delays were planned", "Documents obtained by the outlet.", 11]]),
  "HW News English": youtube([["India level series with last-ball win", "A late six seals it.", 3], ["Star opener ruled out with hamstring strain", "He will miss two Tests.", 6]]),
  Meghnerd: youtube([["Late winner sends holders through to quarter-finals", "Stoppage-time header decides it.", 4]]),
  "Mongabay India": rss([["Grand Slam champion announces retirement at 31", "Cites injuries.", 9]]),
  "BBC Entertainment": rss([["Streaming giant raises prices again", "Basic plan up by 20%.", 5], ["The year's biggest Hindi film crosses 500 crore", "Box office report.", 7], ["Director's cut of cult thriller heads to OTT", "Release date set.", 15]]),
  "Ravish Kumar": youtube([["रवीश कुमार: छात्रों का आंदोलन", "Hindi explainer one.", 3], ["रवीश कुमार: चुनाव आयोग पर सवाल", "Hindi explainer two.", 5], ["रवीश कुमार: शिक्षा नीति", "Hindi explainer three.", 7], ["रवीश कुमार: पेपर लीक", "Hindi explainer four.", 9]]),
  Soompi: rss([["K-pop group confirms first India tour dates", "Shows in Mumbai and Delhi.", 6]]),
  "Carbon Brief": rss([["Phone maker drops the charger, the cable and now the box", "Ships in a sleeve.", 4], ["AI assistant can now book your train tickets", "Feature rolls out in India first.", 10]]),
  "The Wire": rss([["Indian quick-commerce startup raises $300M", "Valuation doubles.", 8]]),
  "Democracy Now": rss([["Sensex hits record high on foreign inflows", "Index up 1.2%.", 5]]),
  "Know Your Meme": rss([["Why everyone is posting 'NPC morning routine' videos", "The trend explained.", 9], ["The comment section is the new front page", "Platform culture explained.", 13]]),
};

const SITES = {
  "Cockroach Janta Party": `<html><head><title>CJP</title></head><body><nav><a href="/about">About us</a><a href="/donate">Donate to the movement today</a></nav>
    <main><a href="/news/school-thik-karo-week-two">School Thik Karo enters week two with 40 new schools surveyed</a>
    <a href="/news/spokesperson-statement-detentions">Spokesperson statement on student detentions outside the Election Commission</a>
    <a href="https://www.instagram.com/cockroachjantaparty">Follow us on Instagram for daily updates</a></main></body></html>`,
};

await mkdir(dir, { recursive: true });
for (const [name, html] of Object.entries(SITES)) await writeFile(path.join(dir, `${shortId(name)}.html`), html);
for (const [name, xml] of Object.entries(F)) await writeFile(path.join(dir, `${shortId(name)}.xml`), xml);
console.log(`Wrote ${Object.keys(F).length} fixture feeds to ${dir}`);
