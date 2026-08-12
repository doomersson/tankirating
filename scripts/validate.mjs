import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [html, css, tokens, app, tracker, players, trackWorkflow, requestWorkflow, rankGuide, hullIcon, turretIcon, modeIcon] = await Promise.all([
  read("index.html"),
  read("assets/styles.css"),
  read("tokens.css"),
  read("assets/app.js"),
  read("data/tracker.json").then(JSON.parse),
  read("data/players.json").then(JSON.parse),
  read(".github/workflows/track.yml"),
  read(".github/workflows/request-player.yml"),
  read("assets/ranks/README.md"),
  read("assets/icons/hull.svg"),
  read("assets/icons/turret.svg"),
  read("assets/icons/mode.svg"),
]);

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const iconSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const equipmentIconPaths = [...new Set(Object.values(tracker.players).flatMap((player) => ["hulls", "turrets", "modes"].flatMap((category) =>
  (player.current.equipment?.[category] || []).map((item) => `assets/icons/${category}/${iconSlug(item.name)}.svg`)
)))];
const equipmentIcons = await Promise.all(equipmentIconPaths.map(read));
const hasDroneIconFolder = await stat(resolve(root, "assets/icons/drones")).then(() => true).catch(() => false);

check(html.includes('name="viewport"'), "viewport metadata is missing");
check(html.includes("viewport-fit=cover"), "safe-area viewport support is missing");
check(html.includes('href="./tokens.css"'), "token stylesheet is not linked relatively");
check(html.includes('src="./assets/app.js"'), "application script is not linked relatively");
check(html.includes('class="view is-active" id="leaderboard-view"'), "leaderboard must be the landing view");
check(!html.includes('id="leaderboard-sort"'), "leaderboard must not use a metric select menu");
check(html.includes('id="leaderboard-period-control"') && html.includes('data-leaderboard-period="all"'), "leaderboard period controls are missing");
check(html.includes('id="compare-search"') && html.includes('id="compare-picker-status"'), "compare player search is missing");
check(!/href="\//.test(html) && !/src="\//.test(html), "root-absolute assets break project GitHub Pages sites");
check(css.includes("overflow-x: clip"), "horizontal overflow clipping is missing");
check(!/overflow-x\s*:\s*hidden/.test(css), "overflow-x hidden can break sticky positioning");
check(!/transition\s*:\s*all/.test(css), "transition-all behavior is forbidden");
check(!/width\s*:\s*100vw/.test(css), "100vw can create desktop overflow");
check(!/background-clip\s*:\s*text/.test(css), "gradient text is forbidden");
check(!/(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i.test(css), "component styles must consume color tokens");
check(css.includes("prefers-reduced-motion"), "reduced-motion support is missing");
check(css.includes("flex-wrap: wrap") && css.includes(".compare-search-field"), "compare picker must expand vertically and remain searchable");
check(css.includes(".leaderboard-table-wrap th:last-child") && css.includes("border-inline-end: var(--rule-thin) solid var(--color-rule)"), "desktop leaderboard column rules are missing");
check((css.match(/font-family:\s*var\(--font-outlier\)/g) || []).length <= 2, "outlier typography is used in more than two roles");
check(css.includes("line-height: 1;"), "intrinsic controls need compact line-height");
check(tokens.includes("--color-accent-ink"), "accent contrast token is missing");
check(tokens.includes("--font-display") && tokens.includes("--font-body"), "font pairing tokens are missing");
check(tokens.includes("--site-header-height") && tokens.includes("--z-sticky-nav"), "sticky table header offset tokens are missing");
check(app.includes("indexedDB"), "local import persistence is missing");
check(app.includes("Export tracker JSON") || html.includes("Export tracker JSON"), "JSON export control is missing");
check(app.includes('["Legend", 1600000]') && app.includes("legendProgress / 200000"), "unlimited Legend rank progression is missing");
check(app.includes("Efficiency rank #") && app.includes("formatDayMonth"), "efficiency position or date-labelled activity is missing");
check(app.includes("leaderboardPeriod: 1") && app.includes("calculatePeriodFor(player, state.leaderboardPeriod)"), "period-specific leaderboard metrics are missing");
check(css.includes(".leaderboard-table-wrap thead th") && css.includes("inset-block-start: calc(var(--site-header-height) + var(--rule-thin))"), "desktop leaderboard header must stay below the site header");
check(app.includes('{ key: "time", label: "Hours Played"') && !app.includes('{ key: "gearScore", label: "Gear"'), "leaderboard Hours Played label or removed Gear column is incorrect");
const leaderboardOrder = ["efficiency", "score", "crystals", "kills13", "kills", "deaths", "kd", "golds", "time"].map((key) => app.indexOf(`{ key: "${key}"`, app.indexOf("function leaderboardColumns")));
check(leaderboardOrder.every((position, index) => position >= 0 && (index === 0 || position > leaderboardOrder[index - 1])), "leaderboard columns are out of the requested order");
check([hullIcon, turretIcon, modeIcon].every((icon) => icon.includes("<svg") && icon.includes('viewBox="0 0 24 24"')), "replaceable equipment SVGs are invalid");
check(equipmentIcons.every((icon) => icon.includes("<svg") && icon.includes('viewBox="0 0 24 24"')), "a tracked hull, turret, or mode is missing its item SVG");
check(!hasDroneIconFolder, "drone item SVGs must remain absent; only the Drone tab carries an icon");
check(app.includes("issues/new?title=") && requestWorkflow.includes("issues:"), "GitHub player request flow is missing");
check(trackWorkflow.includes('cron: "17 */3 * * *"'), "collector must run every three hours");
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
