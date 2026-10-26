# The Daily TL;DR

A Drudge-style link board for five readers aged 19 to 25 in India. Two issues a week, **Monday and Friday**, at most **10 links** each. Every issue is built at about 05:37 Dubai time and shown to readers from **07:30**, and it's curated from the Google Sheets app.

## How an issue is made

1. **About 05:00 to 06:00 Dubai, Monday and Friday:** Vercel Cron calls `api/cron-issue.js`, which starts the GitHub workflow (`.github/workflows/daily.yml`). GitHub's own schedule (05:37 and 06:37) is a backup, because it can start hours late. Automatic starts do nothing if the issue already exists, or if it's no longer Monday or Friday in Dubai. Vercel needs `GH_DISPATCH_TOKEN`: a fine-grained GitHub token with Actions read and write on this repository only.
2. `scripts/build-edition.mjs`:
   - reads your **Inbox** and **Desk** tabs
   - fetches the feeds in `config/sources.json` for the days since the previous issue
   - drops YouTube videos longer than 30 minutes
   - asks Claude to fill whatever room is left under the 10-link limit (at most 3 Hindi items), using `prompts/editorial.md`
   - rewrites and fact-checks the headlines
   - writes `public/data/editions/<date>.json`, keeping the last 8 issues, and commits it; Vercel redeploys
   - mirrors the issue into the **Today** tab
3. The site loads the issue, then applies your Today-tab edits through `/api/overrides`, which refreshes about every minute.
4. If the build fails, nothing is published and GitHub emails you.

**Preview:** `https://the-daily-tldr.vercel.app/?preview=1` shows the next issue before 07:30, including every reader's personal links. It isn't secret; it simply isn't linked from anywhere.

## Your tabs in the Sheet

**Inbox:** links for the next issue. Each row must be used in that issue.

| Column | Meaning |
| --- | --- |
| `issue_date` | Blank means the next issue. A future date holds the row until that issue. |
| `section` | Blank means Editor's Picks (up to 4 an issue). Also `lead`, `campus`, `india`, `world` or `culture`. |
| `url` | Required. Use a newsletter's gift or share link where it has one. |
| `my_headline` | Optional. If blank, Claude writes one from the article's title. |
| `important` | `yes` shows the headline in blue. |
| `for` | A reader's nickname shows the link only on that reader's page. |
| `subscriber` | `yes` adds a [subscriber] tag. |
| `status` | Filled in by the pipeline (`used <date>`). Clear it to reuse the row. |

**Desk:** "Notes from the news desk", above the lead. One row per issue: `teaser` (one line) and `url` (a Google Doc shared as "anyone with the link can view"). With a blank `issue_date` it goes in the next issue. To add a note after an issue is out, put that issue's date in `issue_date`. No row means no Desk box.

**Today:** one row per link in recent issues. Edits show on the site within about a minute.

| Column | What to do |
| --- | --- |
| `my_headline` | Replaces the headline. It also becomes a style example for Claude. |
| `status` | `hide` removes the link. `lead` makes it the lead (the old lead goes back to its own section). `pin` keeps it at the top of its section in every issue. |
| `section`, `rank` | Move a link to another section, or reorder it within one (1 = top). |
| `important`, `for` | As in the Inbox. |
| New row | Add `date`, `url` and `my_headline` (leave `ai_headline` blank) to add a link to a published issue. |

## Focus topics (showcase sections)

A focus is a time-boxed section shown under the lead, for example "Campus Watch, Week 1 of 2". Several can run at once.

1. Write the brief: copy `prompts/focus/_TEMPLATE.md` (or edit `campus.md` / `mideast.md`) and fill in its 7 parts.
2. In `config/focus.json`, set the focus's `enabled` to `true`, plus its `start` date, `days`, `maxLinks` and any extra `sources`.
3. Focus links, including pinned ones, count towards the issue's 10-link limit. When the last day passes, the page goes back to normal by itself.
4. **Pinned links:** in the Sheet, add a row with `section` set to the focus key (`campus`, `mideast`), plus `url` and `my_headline`, and `status` = `pin`. It stays at the top of that section in every issue, marked START HERE, until you clear the status. Pins can also go in regular sections.

Each run's `reports/last-run.json` shows `focusCoverage`: how many candidate stories matched each focus in that issue's window. Use it to check whether `maxLinks` is realistic.

## Personal links for readers

Give each reader `https://the-daily-tldr.vercel.app/?r=<name>`. Each of them opens it in Safari, taps **Share → Add to Home Screen**, and the icon keeps their name. The Clicks tab then shows who clicked what. The page footer tells readers that clicks are counted.

## Changing things

| To change | Edit |
| --- | --- |
| Sources | `config/sources.json`. Roles: `detect`, `prefer`, `neutral`, or `official` (linked only for that body's own statement). Kinds: `rss`, `youtube`, or `site` (any web page: its feed if it has one, otherwise its article links, dated by when first seen) |
| Sections and their maximums, link limit, Hindi cap, video length, schedule times, model | `config/settings.json` (the schedule itself is in `.github/workflows/daily.yml`) |
| What gets picked or excluded | `prompts/editorial.md` |
| Headline voice and starter examples | `prompts/voice.md` |
| Focus topics | `config/focus.json` and `prompts/focus/*.md` |

## One-time setup

### 1. GitHub secrets

In the repository, go to **Settings → Secrets and variables → Actions** and add three secrets:

| Secret | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SHEET_ID` | The long ID in the Sheet's URL, between `/d/` and `/edit` |
| `GOOGLE_SA_KEY` | The entire contents of the service account's JSON key file |

### 2. Google Sheet and service account

1. Create a blank Google Sheet, for example "The Daily TL;DR curation". The job creates the Today, Style and Clicks tabs itself.
2. Go to console.cloud.google.com and create a project called `the-daily-tldr`.
3. Under **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**.
4. Under **IAM & Admin → Service Accounts**, click **Create service account** and name it `tldr-bot`. Skip the optional role steps and click **Done**.
5. Open `tldr-bot`, go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
6. In the Sheet, click **Share** and add the service account's email address (it ends in `iam.gserviceaccount.com`) as an **Editor**.
7. Save the key file's contents as `GOOGLE_SA_KEY` and the Sheet ID as `SHEET_ID`, both in GitHub (step 1) and in Vercel (step 3). Then delete the downloaded file.

### 3. Vercel

1. Go to **Add New → Project** and import `lbwj-droid/the-daily-tldr`. Set Framework Preset to **Other** and leave the build settings empty.
2. Under **Settings → Environment Variables**, add `SHEET_ID` and `GOOGLE_SA_KEY`, then redeploy.

### 4. First run

Go to **Actions → Daily edition → Run workflow**. After that it runs on its own every morning.

## Local development

```bash
npm install
npm test                    # parser tests plus an offline dry run from made-up fixtures
node test/make-fixtures.mjs && node scripts/build-edition.mjs --dry-run --out /tmp/dry
node scripts/dev-server.mjs --data /tmp/dry   # preview on http://localhost:3000
```

## Cost

Each issue makes three Claude Opus 5.5 calls: pick, rewrite and fact-check. At two issues a week that comes to roughly $3 to $5 a month (estimate). Every run logs its actual token usage and estimated cost in `reports/last-run.json`. GitHub Actions, Vercel Hobby and Google Sheets are free at this scale.
