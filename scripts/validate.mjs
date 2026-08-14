import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [html, css, tokens, app, tracker, players, trackWorkflow, requestWorkflow, rankGuide, droneIcon, trackScript] = await Promise.all([
  read("index.html"),
  read("assets/styles.css"),
  read("tokens.css"),
  read("assets/app.js"),
  read("data/tracker.json").then(JSON.parse),
  read("data/players.json").then(JSON.parse),
  read(".github/workflows/track.yml"),
  read(".github/workflows/request-player.yml"),
  read("assets/ranks/README.md"),
  read("assets/icons/drone.svg"),
  read("scripts/track.py"),
]);

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const miscIconFiles = ["crystal.svg", "deaths.svg", "gearscore.svg", "golds.svg", "iconExperience.svg", "iconTime.svg", "premiumicon.svg"];
const miscIcons = await Promise.all(miscIconFiles.map((name) => read(`assets/icons/misc/${name}`)));

check(html.includes('name="viewport"'), "viewport metadata is missing");
check(html.includes("viewport-fit=cover"), "safe-area viewport support is missing");
check(html.includes('href="./tokens.css"'), "token stylesheet is not linked relatively");
check(html.includes('src="./assets/app.js"'), "application script is not linked relatively");
check(html.includes('class="view is-active" id="leaderboard-view"'), "leaderboard must be the landing view");
check(!html.includes('id="leaderboard-sort"'), "leaderboard must not use a metric select menu");
check(html.includes('id="leaderboard-period-control"') && html.includes('data-leaderboard-period="1"') && html.includes('data-leaderboard-period="7"') && html.includes('data-leaderboard-period="all"'), "Day, Week, and All time leaderboard controls are missing");
check(/data-leaderboard-period="7" class="is-active" aria-pressed="true"/.test(html) && app.includes('leaderboardPeriod: 7'), "Week must be the default leaderboard period");
check(/id="tools-dialog"[\s\S]*?data-time-unit="hours"[\s\S]*?data-time-unit="days"/.test(html) && !html.includes('data-time-unit="exact"'), "sitewide Hours and exact Days display controls are missing or the retired Exact option remains");
check(html.includes('id="compare-search"') && html.includes('id="compare-picker-status"'), "compare search elements required by app.js are missing");
check(["hulls", "turrets", "drones", "modules", "modes"].every((category) => html.includes(`data-equipment="${category}"`)), "profile equipment tabs are missing");
check(html.includes('id="profile-overview"') && html.includes('id="profile-period-summary"') && html.includes('data-profile-section="overview"') && html.includes('data-profile-section="period"'), "profile Overview or Period summary switch is missing");
check(/id="profile-overview"[\s\S]*?id="equipment-summary"[\s\S]*?id="overview-kills"[\s\S]*?id="overview-deaths"[\s\S]*?id="overview-kd"/.test(html), "profile Overview must lead with loadout and overall account statistics");
check(!html.includes("Favorite item in each category") && !/<span>Lifetime<\/span>/.test(html), "profile overview still includes redundant explanatory copy");
check(/id="profile-period-summary"[\s\S]*?class="period-console period-summary-board"[\s\S]*?period-highlight-grid[\s\S]*?period-activity-panel/.test(html) && !html.includes("Period range"), "Period range and summary must share one compact panel before recent activity");
check(["day", "week", "month", "year", "all", "custom"].every((period) => html.includes(`data-period="${period}"`)), "Day, Week, Month, Year, All Time, or Custom period controls are missing");
check(["first", "previous", "next", "latest"].every((direction) => html.includes(`data-period-nav="${direction}"`)) && app.includes("navigateProfilePeriod"), "period first, previous, next, or latest navigation is missing");
check(html.includes('id="rating-date"') && html.includes('id="custom-date-start"') && html.includes('id="custom-date-end"') && app.includes("ensureCustomDates"), "reference-date or custom-range inputs are missing");
check(/class="period-mode-toolbar"[\s\S]*?id="period-control"[\s\S]*?id="period-date-fields"/.test(html) && css.includes(".period-mode-toolbar"), "period modes and reference dates must share one compact toolbar");
check(html.includes('id="stat-range-kd"') && html.includes('id="stat-kills-hour"') && html.includes('id="stat-crystals-hour"') && html.includes('id="stat-score-hour"') && html.includes('id="stat-time-day"'), "profile K/D, hourly, or time-per-day headline metrics are missing");
check(html.includes('id="overview-crystals-experience"') && html.includes('id="period-crystals-experience"') && app.includes("safeDivide(period.delta.crystals, period.delta.score)"), "Crystals / Experience is missing from lifetime or period statistics");
check(["crystals", "score", "ratio", "time", "kills", "deaths", "golds", "kd"].every((icon) => html.includes(`data-metric-icon="${icon}"`)) && html.includes('class="metric-icon__slash">/</span>') && css.includes(".metric-icon__part--kills") && css.includes(".metric-icon__part--deaths") && css.includes('url("./icons/modes/deathmatch.svg")') && app.includes("metricIconMarkup") && miscIcons.every((icon) => icon.includes("<svg")), "shared metric artwork, composite K/D icon, or account-detail icon mapping is incomplete");
check(!html.includes(">Score<") && !html.includes(">Score /") && app.includes('{ key: "score", label: "Experience" }') && app.includes('metricRow("Experience"'), "the player score metric must be labelled Experience everywhere in the interface");
check(app.includes('state.period === "month"') && app.includes('state.period === "year"') && app.includes('state.period === "custom"') && app.includes("shiftMonthDateKey") && app.includes("shiftYearDateKey"), "calendar month, year, or custom range calculations are missing");
check(!/href="\//.test(html) && !/src="\//.test(html), "root-absolute assets break project GitHub Pages sites");
check(css.includes("overflow-x: clip"), "horizontal overflow clipping is missing");
check(!/overflow-x\s*:\s*hidden/.test(css), "overflow-x hidden can break sticky positioning");
check(!/transition\s*:\s*all/.test(css), "transition-all behavior is forbidden");
check(!/width\s*:\s*100vw/.test(css), "100vw can create desktop overflow");
check(!/background-clip\s*:\s*text/.test(css), "gradient text is forbidden");
check(!/(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i.test(css), "component styles must consume color tokens");
check(css.includes("prefers-reduced-motion"), "reduced-motion support is missing");
check((css.match(/font-family:\s*var\(--font-outlier\)/g) || []).length <= 2, "outlier typography is used in more than two roles");
check(css.includes("line-height: 1;"), "intrinsic controls need compact line-height");
check(tokens.includes("--color-accent-ink"), "accent contrast token is missing");
check(tokens.includes("--color-data-1") && tokens.includes("--color-data-other"), "equipment pie data-color tokens are missing");
check(tokens.includes("--font-display") && tokens.includes("--font-body"), "font pairing tokens are missing");
check(tokens.includes("--site-header-height") && tokens.includes("--z-sticky-nav"), "sticky leaderboard offset tokens are missing");
check(app.includes("indexedDB"), "local import persistence is missing");
check(app.includes("Export tracker JSON") || html.includes("Export tracker JSON"), "JSON export control is missing");
check(app.includes('["Legend", 1600000]') && app.includes("legendProgress / 200000"), "unlimited Legend rank progression is missing");
check(app.includes("Efficiency rank #") && app.includes("formatDayMonth"), "efficiency position or date-labelled activity is missing");
check(app.includes('leaderboardSort: "kills13"') && app.includes("calculatePeriodFor(player, state.leaderboardPeriod)"), "Kills / 13m must be the default leaderboard sort");
check(app.includes('leaderboardDirection: "desc"') && app.includes('state.leaderboardDirection === "desc" ? "asc" : "desc"'), "leaderboard sort direction toggle is missing");
check(app.includes('{ key: "time", label: "Time played"') && !app.includes('{ key: "gearScore", label: "Gear"'), "leaderboard Time played label or removed Gear column is incorrect");
const leaderboardStart = app.indexOf("function leaderboardColumns");
const leaderboardOrder = ["efficiency", "score", "crystals", "crystalsExperience", "kills13", "kills", "deaths", "kd", "golds", "time"].map((key) => app.indexOf(`{ key: "${key}"`, leaderboardStart));
check(leaderboardOrder.every((position, index) => position >= 0 && (index === 0 || position > leaderboardOrder[index - 1])), "leaderboard columns are out of the requested order");
check(app.includes("function equipmentIconSource") && app.includes('return "./assets/icons/modes/juggernaut.svg"') && app.includes("function moduleIconSlug"), "Juggernaut overrides or module equipment icon mapping is missing");
check(css.includes(".equipment-icon--modules") && css.includes('url("./icons/turrets/all.svg")'), "Modules category icon is missing");
check(app.includes("itemTime / total >= 0.05") && app.includes('name: "Others"'), "equipment below 5% must be grouped into Others on the chart");
check(app.includes("var legend = items.map") && app.includes('zeroTime ? "No recorded usage"') && !app.includes("positive(item.timeMs) > 0") && !app.includes("In Others slice"), "the equipment legend must retain zero-time API items without repeating chart grouping labels");
const opexDroneNames = tracker.players?.["opex-rah"]?.current?.equipment?.drones?.map((item) => item.name) || [];
check(["Hyperion", "Mechanic", "Defender", "Crisis", "Trickster", "Booster", "Brutus", "Hyperion XT", "Default", "Crisis XT", "Saboteur"].every((name) => opexDroneNames.includes(name)), "Opex-Rah's complete drone list is missing from tracker data");
check(html.includes("equipment-share-panel") && /\.equipment-share-panel \.equipment-tabs\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/.test(css) && /\.equipment-share-panel \.usage-legend\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(css), "equipment category rail, two-column list, or right-side chart layout is missing");
check(/class="toast-region"[\s\S]*?id="data-notice"/.test(html) && app.includes("showDataNoticeToast") && app.includes("hideDataNoticeToast"), "profile data notice must render as an auto-hiding toast");
check(app.includes('class="usage-pie-slice"') && app.includes("equipmentPieSlicePath") && app.includes('class="usage-legend-item" role="listitem" tabindex="0"') && app.includes(".usage-legend-item[data-highlight-key]") && app.includes("setEquipmentPieHighlight") && css.includes(".usage-pie-layout.has-highlight") && css.includes(".usage-legend-item.is-highlighted"), "bidirectional equipment pie-to-legend highlighting or proper pie wedges are missing");
check(app.includes('state.equipment === "modules" ? ""') && app.includes("Most used module · "), "module usage must show percentages without misleading hour totals");
check(css.includes("@keyframes pie-unfold") && css.includes(".usage-pie.is-unfolding"), "animated equipment pie rendering is missing");
check(!app.includes('class="usage-bar"'), "equipment usage bars must be replaced by the pie breakdown");
check(html.includes('class="equipment-icon equipment-icon--drones"') && app.includes('class="equipment-item-icon favorite-artwork" src="./assets/icons/drone.svg"') && css.includes('mask-image: url("./icons/drone.svg")') && droneIcon.includes('viewBox="0 0 80 80"'), "drone summary image or tab mask is missing");
check(css.includes("scrollbar-width: none") && css.includes(".segmented-control::-webkit-scrollbar"), "segmented control scrollbar is not hidden");
check(css.includes(".equipment-item-icon.favorite-artwork") && css.includes("width: 4rem;") && css.includes("height: 4rem;"), "favorite equipment artwork must render at 4rem");
check(app.includes("hour < 24") && app.includes("Math.round(fill * 4) * 25") && css.includes(".activity-slice.fill-100::after"), "24-slice quarter-hour activity rendering is missing");
check(app.includes("resolvedOptions().timeZone") && app.includes("ratingBoundaryMs") && app.includes("mondayDateKey"), "viewer-timezone rating dates or Monday weekly boundaries are missing");
check(html.includes('id="activity-zone-note"') && !html.includes("Stockholm time"), "Recent activity must identify the viewer timezone instead of hard-coding Stockholm");
check(css.includes(".analysis-grid > *") && css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))") && css.includes("@media (max-width: 30rem)"), "mobile profile containment or equipment reflow is missing");
check(app.includes("rateHour(period.delta.kills") && app.includes("rateHour(period.delta.crystals") && app.includes("rateHour(period.delta.score"), "selected-period hourly rates are missing");
check(app.includes('state.period === "all") return calculateLifetimePeriod(player)') && app.includes("function calculateLifetimePeriod") && app.includes("lifetime account totals"), "All Time must render lifetime account totals instead of tracked snapshot deltas");
check(app.includes('timeUnit: "days"') && app.includes('return saved === "hours" ? "hours" : "days"') && app.includes("formatTimePlayed") && !app.includes('["exact", "hours", "days"]'), "sitewide Hours/Days preference or legacy Exact migration is incomplete");
check(app.includes('"experience", "crystals_per_experience"'), "profile CSV must expose Experience and the Crystals / Experience ratio");
check(trackWorkflow.includes('cron: "17 * * * *"'), "collector must run every hour");
check(trackScript.includes('ZoneInfo("Europe/Stockholm")') && trackScript.includes("rating_boundary_due"), "collector must retain Stockholm rating-boundary snapshots");
check(trackScript.includes('"modules": modules') && trackScript.includes('"resistanceModules"') && trackScript.includes("first_usage_list") && trackScript.includes('"RAILGUN_RESISTANCE": "railgun"') && trackScript.includes('module["icon"]'), "collector must retain protection-module usage and local icon keys from the ratings API");
check(app.includes("issues/new?title=") && requestWorkflow.includes("issues:"), "GitHub player request flow is missing");
check(trackWorkflow.includes("actions/checkout@v5") && trackWorkflow.includes("actions/setup-python@v6"), "collector actions must use Node 24-compatible releases");
check(rankGuide.includes("31.png") && rankGuide.includes("Legend"), "rank icon upload guide is missing");
check(tracker.schemaVersion === 1 && tracker.players && typeof tracker.players === "object", "tracker.json schema is invalid");
check(!JSON.stringify(tracker).includes('"image"'), "tracker.json still contains legacy equipment images");
check(Array.isArray(players.players) && players.players.length <= 100, "players.json must contain no more than 100 players");

const syntax = spawnSync(process.execPath, ["--check", resolve(root, "assets/app.js")], { encoding: "utf8" });
check(syntax.status === 0, syntax.stderr || "app.js syntax check failed");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${Object.keys(tracker.players).length} tracked player record(s) and static site invariants.`);
