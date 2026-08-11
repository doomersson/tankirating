# Tanki Tracker — free GitHub Pages edition

A static community statistics tracker for up to 100 Tanki Online accounts. It uses GitHub Actions as the hourly collector and GitHub Pages as the website, so it does not require a server or database.

The collector reads Tanki’s public profile response from:

```text
https://ratings.tankionline.com/api/eu/profile/?user=USERNAME&lang=en
```

The public API does not currently send a browser CORS header, so the website cannot safely collect profiles itself. The scheduled GitHub workflow performs that request and commits compact snapshots into `data/tracker.json`.

## What is tracked

- Exact accumulated battle time, formatted as days, hours and minutes.
- Kills, deaths, lifetime K/D, period K/D and kills per 13 minutes.
- Score, earned crystals, gold boxes, efficiency and official efficiency position.
- Score and crystals per 13 minutes.
- Rank progress and gear score.
- Most-played hull, turret, drone and battle mode.
- Hourly changed snapshots, trend charts and a 14-day activity view.
- Player leaderboard and up-to-four-player comparison.
- Full JSON backup import/export and per-profile CSV export.

## First deployment

1. Create a GitHub repository. Use `YOURNAME.github.io` for a root site, or any other repository name for `YOURNAME.github.io/REPOSITORY/`.
2. Upload **the contents of this folder** to the repository root. `index.html`, `data`, `scripts` and `.github` must be visible at the root.
3. Open the repository’s **Settings → Actions → General** page. Under “Workflow permissions”, choose **Read and write permissions**, then save.
4. Open **Settings → Pages**. Under “Build and deployment”, select **GitHub Actions**.
5. Open **Actions → Track players → Run workflow**. The first run fills `data/tracker.json` with Borz’s current profile.
6. Open **Actions → Deploy GitHub Pages** and run it once if deployment did not start automatically.

The tracking workflow runs at minute 17 of every hour. GitHub may start scheduled workflows a little late during busy periods.

## Add or remove accounts

Edit `data/players.json` on GitHub:

```json
{
  "players": [
    "Borz",
    "SecondFriend",
    "ThirdFriend"
  ],
  "region": "eu",
  "language": "en",
  "concurrency": 4,
  "retentionDays": 730
}
```

Commit the edit, then manually run **Track players** once. After that, hourly collection continues automatically.

The script accepts at most 100 unique accounts. Use exact Tanki usernames. Removing a name from `players.json` stops new collection but intentionally keeps its existing history in `tracker.json`, protecting against accidental edits.

## Back up and restore

On the website, open **Data tools → Export tracker JSON**. Keep that file somewhere safe.

There are two ways to import it:

- **Temporary/local inspection:** choose **Import tracker JSON** on the website. The backup is saved in that browser’s IndexedDB and does not change the public repository.
- **Permanent public restore:** upload the exported file over `data/tracker.json` in GitHub, commit it, then run **Track players** and **Deploy GitHub Pages**.

The collector continues from the restored history instead of starting over.

## Storage behavior

To keep the repository small, the collector stores:

- One compact history point whenever cumulative statistics change.
- One heartbeat snapshot after roughly 23 hours without a changed snapshot.
- Only normalized current equipment totals, excluding the large paint and module inventories.
- Two years of history by default; change `retentionDays` if needed.

For approximately 100 lightly or moderately active accounts, this is substantially smaller than storing every full API response every hour.

## Limitations

- GitHub scheduled workflows are not real-time and occasionally start late.
- Playtime inside an hourly interval is known, but the exact minute within that interval is not. The activity chart attributes the change to the collection day.
- Historical charts begin when this tracker begins. Tanki’s profile endpoint supplies cumulative totals, not earlier snapshots.
- If the Tanki profile response changes, `scripts/track.py` might need an update.
- This is a community project and is not affiliated with Tanki Online.
