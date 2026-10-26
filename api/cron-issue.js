// GET /api/cron-issue: called by Vercel Cron (see vercel.json) early on Monday and Friday, Dubai time.
// It asks GitHub to run the Issue workflow, because GitHub's own schedule can start hours late.
// The run is told to skip if that day's issue already exists, so extra calls never cost a rebuild.
// Needs GH_DISPATCH_TOKEN: a fine-grained GitHub token with Actions read and write on this repository only.
const REPO = "lbwj-droid/the-daily-tldr";
const ISSUE_DAYS = new Set(["Mon", "Fri"]);

export default async function handler(req, res) {
  // If CRON_SECRET is set in Vercel, only Vercel Cron (which sends it) may call this.
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Dubai" }).format(new Date());
  if (!ISSUE_DAYS.has(day)) return res.status(200).json({ dispatched: false, reason: `${day} is not an issue day` });
  if (!process.env.GH_DISPATCH_TOKEN) return res.status(500).json({ dispatched: false, reason: "GH_DISPATCH_TOKEN is not set in Vercel" });

  const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { date: "", if_missing: "true" } }),
  });
  if (gh.status !== 204) {
    const detail = await gh.text();
    console.error(`GitHub dispatch failed: ${gh.status} ${detail}`);
    return res.status(502).json({ dispatched: false, reason: `GitHub answered ${gh.status}`, detail: detail.slice(0, 300) });
  }
  return res.status(200).json({ dispatched: true, day });
}
