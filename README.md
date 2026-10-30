# Web performance monitor

Runs Lighthouse (lab data) on the pages in [config.json](config.json) at 00:00, 10:00, 17:00 and 21:00 UTC via GitHub Actions, pulls real-user Core Web Vitals from the CrUX API, and charts everything in [docs/index.html](docs/index.html).

## Setup

1. Create a **public** GitHub repo (GitHub Pages on private repos needs a paid plan) and push this folder to it. It contains no secrets.
2. Repo **Settings > Secrets and variables > Actions**: add `CRUX_API_KEY`. Use a Google Cloud API key with the *Chrome UX Report API* enabled (free).
3. Repo **Settings > Pages**: deploy from branch `main`, folder `/docs`.
4. **Actions** tab > *Web performance monitor* > *Run workflow* to collect the first data point.

The chart is then at `https://<user>.github.io/<repo>/`.

## Running a test on demand

- GitHub: **Actions > Web performance monitor > Run workflow**. Optionally enter a single URL and/or the number of runs. Leave both blank to test every page.
- Terminal: `gh workflow run monitor.yml -f url=https://suspectpackage.com/ -f runs=3`
- The GitHub mobile app can also trigger it.

On-demand results are labelled `manual` and appear as their own line on the chart. A URL that isn't in `config.json` shows in the page dropdown once it has data.


## How it works

- `scripts/measure.mjs`: warms each URL, runs Lighthouse `runsPerUrl` times, stores the median in `docs/data/lighthouse.csv`.
- `scripts/crux.mjs`: one real-user p75 snapshot per URL per day in `docs/data/crux.csv` (falls back to origin data for low-traffic URLs).
- The workflow commits the CSVs back to the repo, so history is just git.

## Notes

- Change pages, devices (`mobile`, `desktop`) or runs in `config.json`. If you change `slotsUtc`, update the cron line in `.github/workflows/monitor.yml` too.
- Scheduled runs can start 5-15 minutes late; each result is labelled with the nearest configured slot.
- GitHub disables scheduled workflows after 60 days without repo activity. Re-enable from the Actions tab if that happens.
- Local test: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LIMIT_URLS=1 RUNS=1 node scripts/measure.mjs`. Local runs are labelled `manual`.
- View locally: `cd docs && python3 -m http.server`.
- Basket and checkout redirect when the cart is empty, so those results may reflect the redirect target. The script logs a note when that happens.
