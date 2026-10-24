# The Daily TL;DR

A one-page, Drudge-style link board of the day's news for five readers aged 19 to 25 in India. It rebuilds itself every morning at about 06:22 IST, and you can curate it from the Google Sheets app on your phone.

## How it works

1. **06:22 IST, GitHub Actions** (`.github/workflows/daily.yml`) runs `scripts/build-edition.mjs`:
   - fetches every feed in `config/sources.json` (RSS, Substack and YouTube channels)
   - asks Claude to pick 1 lead story and 19 links using `prompts/editorial.md`
   - asks Claude to rewrite the headlines using `prompts/voice.md` plus your 30 latest corrections from the Sheet
   - writes `public/data/editions/<date>.json`, keeps 14 days, and commits it; Vercel redeploys on the push
   - writes one row per link into the **Today** tab of the Google Sheet
2. **The site** (`public/`) loads the day's JSON, then applies your Sheet edits through `/api/overrides`, which is cached for 5 minutes.
3. **Clicks** are sent to `/api/click`, which adds a row to the **Clicks** tab.

If the build fails, nothing is committed, so the site keeps the last good page, and GitHub emails you. If the page is published but something needs a look (more than 30% of feeds down, the Sheet unreachable, or a section short by 2 or more links), the job is marked failed, so you also get an email.

## Curating from the Sheet (Today tab)

| Column | What to do |
| --- | --- |
| `my_headline` | Type your own headline. It replaces Claude's on the live page within about 5 minutes, and it becomes a style example for tomorrow's rewrite. |
| `status` | `hide` removes the link. `lead` makes it the top story. `pin` keeps it at the top of its section every day. |
| New row | To add a link of your own, fill in `date`, `section` (india, world, culture, sports, techmoney, internet), `url` and `my_headline`. Leave `ai_headline` blank. |

## Focus topics (showcase sections)

A focus is a time-boxed section shown under the lead, for example "Campus Watch, Day 6 of 21". Several can run at once.

1. Write the brief: copy `prompts/focus/_TEMPLATE.md` (or edit `campus.md` / `mideast.md`) and fill in its 7 parts.
2. In `config/focus.json`, set the focus's `enabled` to `true`, plus its `start` date, `days`, `maxLinks` and any extra `sources`.
3. While any focus is live, the regular sections shrink to `regularQuotasWhenFocused`. When the last day passes, the page goes back to normal by itself.
4. **Pinned links:** in the Sheet, add a row with `section` set to the focus key (`campus`, `mideast`), plus `url` and `my_headline`, and `status` = `pin`. It stays at the top of that section every day, marked START HERE, until you clear the status. Pins can also go in regular sections.

Each run's `reports/last-run.json` shows `focusCoverage`: how many candidate stories matched each focus that day. Use it to check whether `maxLinks` is realistic.

## Personal links for readers

Give each reader `https://<your-site>.vercel.app/?r=<name>`. Each of them opens it in Safari, taps **Share → Add to Home Screen**, and the icon keeps their name. The Clicks tab then shows who clicked what. The page footer tells readers that clicks are counted.

## Changing things

| To change | Edit |
| --- | --- |
| Sources | `config/sources.json`. Roles: `detect`, `prefer`, `neutral`, or `official` (linked only for that body's own statement). Kinds: `rss`, `youtube`, or `site` (any web page: its feed if it has one, otherwise its article links, dated by when first seen) |
| Sections, quotas, model, paywalled domains | `config/settings.json` |
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

The job makes two Claude Opus 5.5 calls a day, an estimated $0.44 a day or about $13 a month. Every run logs its actual token usage and estimated cost in `reports/last-run.json`. GitHub Actions, Vercel Hobby and Google Sheets are free at this scale.
