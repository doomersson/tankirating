# Tanki Tracker — free GitHub Pages edition
[https://doomersson.github.io/tankirating/](https://doomersson.github.io/tankirating/)

A static community statistics tracker for up to 100 Tanki Online accounts. GitHub Actions collects public profiles every hour, stores compact history in the repository, and publishes the interface with GitHub Pages. There is no paid server or database.

The collector reads Tanki’s public profile response from:

```text
https://ratings.tankionline.com/api/eu/profile/?user=USERNAME&lang=en
```

The API does not currently send the browser CORS header needed for direct collection from GitHub Pages. Collection therefore happens in GitHub Actions and the site reads the generated `data/tracker.json` file.

## What is tracked

- Accumulated time played, with Hours and exact Days display modes.
- Kills, deaths, lifetime and period K/D, and kills per 13 minutes.
- Experience, earned crystals, gold boxes, gear score, efficiency value, and official efficiency position.
- Experience and crystals per 13 minutes.
- Rank and EXP progress, including unlimited Legend levels every 200,000 EXP.
- Most-played hull, turret, drone, protection module, and battle mode.
- Changed snapshots, trend charts, and a recent activity view labelled by date.
- A sortable all-player leaderboard with Day, Week, and All time statistics.
- Leaderboard columns for efficiency, score, crystals, kills per 13 minutes, kills, deaths, K/D, golds, and hours played.
- A searchable, vertically expanding picker for up-to-four-player comparisons.
- Full JSON backup import/export and per-profile CSV export.

Equipment entries keep only `name`, `timeMs`, and `score`; protection modules also keep a local `icon` slug derived from their resistance property. Remote equipment image URLs are not stored.

Profile equipment names use matching lowercase SVG filenames from `assets/icons/hulls`, `assets/icons/turrets`, and `assets/icons/modes`; for example, `Mammoth` uses `mammoth.svg` and `Railgun` uses `railgun.svg`. Protection modules reuse their matching turret icons plus `all.svg`, `crit.svg`, and `mine.svg`. Juggernaut hulls and Terminator turrets intentionally share `modes/juggernaut.svg`.

## First deployment

1. Put these files at the root of the `doomersson/tankirating` repository.
2. Open **Settings → General → Features** and make sure **Issues** is enabled. Public player requests use Issues.
3. Open **Settings → Actions → General**. Under **Workflow permissions**, choose **Read and write permissions**, then save.
4. Open **Settings → Pages**. Under **Build and deployment**, select **GitHub Actions**.
5. Open the repository’s **Actions** tab, choose **Track players**, and select **Run workflow** once.
6. The site will publish at `https://doomersson.github.io/tankirating/`. Run **Deploy GitHub Pages** manually once only if the first deployment did not start automatically.

The scheduled collector runs at minute 17 every hour. GitHub can start scheduled workflows a little late during busy periods.

## Public player requests and refreshes

The search box finds existing players. For an exact username that is not tracked, it offers a **Request tracking** link. A profile’s **Request refresh** button uses the same flow:

1. The visitor signs in to GitHub and submits the prefilled Issue.
2. The **Request player** workflow validates the issue title and calls Tanki Ratings.
3. A valid public profile is added or refreshed and committed.
4. The Action replies to the Issue, closes it, and redeploys the site.

If Tanki returns `{"response":null,"responseType":"NOT_FOUND"}`, the request is rejected because the account is private or does not exist.

GitHub sign-in and GitHub’s own abuse controls are the free anti-bot gate. A CAPTCHA cannot safely write to a repository from a browser-only GitHub Pages site: its secret must live on a server. If fully anonymous in-page requests are needed later, the small free option is a Cloudflare Worker with Turnstile that validates the CAPTCHA and dispatches the workflow.

## Update a changed username

Username changes keep the original configured name as the stable player ID, so historical snapshots and old profile links continue to work. Only the repository owner can run the migration:

1. Open **Actions → Update player username → Run workflow**.
2. Enter any current or previous tracked username in **Current or previous tracked username**.
3. Enter the player’s new Tanki username in **New Tanki username**, then run the workflow.

The workflow verifies the new public profile, updates the next tracking lookup, preserves every previous username, immediately collects a snapshot, and redeploys the site. Previous names appear in the dropdown beside the current profile name; long histories scroll instead of expanding the page. The workflow job is gated by `github.actor == github.repository_owner`, so visitors and collaborators cannot use it to rewrite identity history.

## Add or remove accounts manually

Edit `data/players.json`:

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
  "retentionDays": 730,
  "usernameChanges": {
    "SecondFriend": {
      "current": "SecondFriendNew",
      "previous": ["SecondFriend"]
    }
  }
}
```

Commit the edit, then run **Track players** once. The `players` entries are stable IDs; use the owner workflow above instead of replacing one after a nickname change. The script accepts at most 100 unique accounts. Removing a name stops new collection but intentionally keeps its history in `tracker.json` so an accidental edit is recoverable.

## Add rank icons

Create or use the existing `assets/ranks` folder and upload 31 square transparent PNG files:

```text
assets/ranks/01.png  Recruit
assets/ranks/02.png  Private
...
assets/ranks/30.png  Generalissimo
assets/ranks/31.png  Legend
```

`31.png` is reused for Legend, Legend 2, Legend 3, and every later Legend level. Images at least 80×80 px are recommended. Until an icon exists, the interface automatically falls back to the numeric rank.

Using GitHub’s website: open `assets/ranks`, choose **Add file → Upload files**, drag the 31 PNGs in, and commit. Filenames must keep the leading zero and lowercase `.png` extension.

## Back up and restore

Open **Data tools → Export tracker JSON** on the site and keep the downloaded file somewhere safe.

- **Temporary/local inspection:** choose **Import tracker JSON**. It is stored in that browser’s IndexedDB and does not change the public repository.
- **Permanent public restore:** upload the exported file over `data/tracker.json`, commit it, then run **Track players**. The collector continues from the restored history.

## Storage behavior

To keep the repository small, the collector stores one compact point when cumulative statistics change, one heartbeat after roughly 23 unchanged hours, normalized equipment totals, and two years of history by default. For up to 100 accounts, this is much smaller than saving full API responses every hour.

## Limitations

- GitHub scheduled workflows are not real-time and occasionally start late.
- A requested refresh normally takes a few minutes for collection and deployment; it is not an immediate browser-side API call.
- Playtime inside a one-hour interval is known, but the exact minute inside that interval is not. Activity is attributed to the collection date.
- Historical charts begin when this tracker starts. Tanki’s endpoint supplies cumulative totals, not older snapshots.
- If the Tanki profile response changes, `scripts/track.py` may need an update.
- This is a community project and is not affiliated with Tanki Online.
