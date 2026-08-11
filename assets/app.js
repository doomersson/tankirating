(function () {
  "use strict";

  var MS_13_MINUTES = 13 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DATA_URL = "./data/tracker.json";
  var DB_NAME = "tanki-tracker-backups";
  var STORE_NAME = "imports";
  var number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var decimal = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var shortNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  var dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  var shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

  var ranks = [
    "Unknown", "Recruit", "Private", "Gefreiter", "Corporal", "Master Corporal", "Sergeant",
    "Staff Sergeant", "Master Sergeant", "First Sergeant", "Sergeant-Major", "Warrant Officer 1",
    "Warrant Officer 2", "Warrant Officer 3", "Warrant Officer 4", "Warrant Officer 5",
    "Third Lieutenant", "Second Lieutenant", "First Lieutenant", "Captain", "Major",
    "Lieutenant Colonel", "Colonel", "Brigadier", "Major General", "Lieutenant General",
    "General", "Marshal", "Field Marshal", "Commander", "Generalissimo", "Legend"
  ];

  var state = {
    data: null,
    siteData: null,
    localMode: false,
    currentPlayerId: null,
    view: "profile",
    period: 7,
    metric: "score",
    equipment: "hulls",
    compare: [],
    searchIndex: 0
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    Promise.all([fetchSiteData(), loadImportedData()])
      .then(function (results) {
        state.siteData = results[0];
        var imported = results[1];
        if (imported) {
          state.data = imported;
          state.localMode = true;
        } else {
          state.data = state.siteData;
        }
        finishLoading();
      })
      .catch(function (error) {
        showFatal(error);
      });
  }

  function cacheElements() {
    var ids = [
      "data-notice", "data-notice-text", "use-site-data", "rank-token", "profile-context",
      "profile-title", "player-meta", "hero-efficiency", "hero-position", "total-time",
      "period-time", "activity-state", "stat-kills", "delta-kills", "stat-kd", "period-kd",
      "stat-k13", "period-k13", "stat-c13", "period-crystals", "stat-s13", "period-score",
      "trend-summary", "trend-chart", "equipment-summary", "equipment-list", "activity-chart",
      "account-details", "leaderboard-sort", "leaderboard-list", "compare-picker", "compare-empty",
      "comparison", "global-empty", "footer-sync", "search-trigger", "mobile-search", "search-dialog",
      "player-search", "search-results", "tools-trigger", "tools-dialog", "export-data", "import-data",
      "import-trigger", "import-status", "profile-csv", "toast-region"
    ];
    ids.forEach(function (id) { elements[id] = document.getElementById(id); });
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { navigateToView(button.dataset.view); });
    });

    document.getElementById("period-control").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-period]");
      if (!button) return;
      state.period = button.dataset.period === "all" ? "all" : Number(button.dataset.period);
      setActiveButton(event.currentTarget, button, ".is-active");
      renderProfile();
      renderComparison();
    });

    document.getElementById("metric-switcher").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-metric]");
      if (!button) return;
      state.metric = button.dataset.metric;
      setActiveButton(event.currentTarget, button, ".is-active");
      renderTrend();
    });

    document.getElementById("equipment-tabs").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-equipment]");
      if (!button) return;
      state.equipment = button.dataset.equipment;
      event.currentTarget.querySelectorAll("button").forEach(function (item) {
        item.setAttribute("aria-selected", item === button ? "true" : "false");
      });
      renderEquipmentList(getCurrentPlayer());
    });

    elements["leaderboard-sort"].addEventListener("change", renderLeaderboard);
    elements["search-trigger"].addEventListener("click", openSearch);
    elements["mobile-search"].addEventListener("click", openSearch);
    elements["tools-trigger"].addEventListener("click", function () { openDialog(elements["tools-dialog"]); });
    elements["player-search"].addEventListener("input", function () {
      state.searchIndex = 0;
      renderSearchResults();
    });
    elements["player-search"].addEventListener("keydown", handleSearchKeys);
    elements["search-results"].addEventListener("click", function (event) {
      var item = event.target.closest("button[data-player-id]");
      if (item) selectPlayer(item.dataset.playerId);
    });
    elements["leaderboard-list"].addEventListener("click", function (event) {
      var item = event.target.closest("button[data-player-id]");
      if (item) selectPlayer(item.dataset.playerId);
    });
    elements["compare-picker"].addEventListener("click", handleComparePick);
    elements["export-data"].addEventListener("click", exportTracker);
    elements["import-trigger"].addEventListener("click", function () { elements["import-data"].click(); });
    elements["import-data"].addEventListener("change", importTracker);
    elements["profile-csv"].addEventListener("click", exportProfileCsv);
    elements["use-site-data"].addEventListener("click", clearImportedData);

    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () { closeDialog(button.closest("dialog")); });
    });
    document.querySelectorAll("dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    });

    window.addEventListener("hashchange", applyRoute);
  }

  function fetchSiteData() {
    return fetch(DATA_URL, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("The tracker data file could not be loaded.");
        return response.json();
      })
      .then(validateTracker);
  }

  function validateTracker(data) {
    if (!data || Number(data.schemaVersion) !== 1 || !data.players || typeof data.players !== "object") {
      throw new Error("This backup is not a Tanki Tracker schema version 1 file.");
    }
    return data;
  }

  function finishLoading() {
    var ids = getPlayerIds();
    if (!ids.length) {
      showEmpty();
      updateDataNotice();
      return;
    }
    state.currentPlayerId = ids[0];
    applyRoute();
    renderAll();
  }

  function showEmpty() {
    document.querySelectorAll(".view").forEach(function (view) { view.classList.remove("is-active"); view.hidden = true; });
    elements["global-empty"].classList.remove("is-hidden");
  }

  function showFatal(error) {
    showEmpty();
    elements["data-notice"].classList.add("is-stale");
    elements["data-notice-text"].textContent = error.message || "The tracker data could not be loaded.";
    showToast("Data load failed. Check data/tracker.json and reload the page.");
  }

  function renderAll() {
    elements["global-empty"].classList.add("is-hidden");
    updateDataNotice();
    renderProfile();
    renderLeaderboard();
    renderComparePicker();
    renderComparison();
    renderSearchResults();
  }

  function getPlayerIds() {
    return state.data ? Object.keys(state.data.players).filter(function (id) {
      return state.data.players[id] && state.data.players[id].current;
    }) : [];
  }

  function getCurrentPlayer() {
    return state.data && state.data.players[state.currentPlayerId];
  }

  function updateDataNotice() {
    var generated = parseDate(state.data && state.data.generatedAt);
    var age = generated ? Date.now() - generated.getTime() : Infinity;
    elements["data-notice"].classList.toggle("is-stale", age > 6 * 60 * 60 * 1000);
    if (state.localMode) {
      elements["data-notice-text"].textContent = "Local backup · exported " + formatDateTime(state.data.generatedAt);
      elements["use-site-data"].classList.remove("is-hidden");
    } else {
      elements["data-notice-text"].textContent = "Site data · updated " + formatRelativeTime(state.data.generatedAt);
      elements["use-site-data"].classList.add("is-hidden");
    }
    elements["footer-sync"].textContent = generated ? "Snapshot " + formatDateTime(state.data.generatedAt) : "Awaiting data";
  }

  function renderProfile() {
    var player = getCurrentPlayer();
    if (!player) return;
    var current = player.current;
    var period = calculatePeriod(player);
    var lifetimeTime = positive(current.totalTimeMs);
    var lifetimeKd = safeDivide(current.kills, current.deaths);
    var lifetimeK13 = rate13(current.kills, lifetimeTime);
    var lifetimeC13 = rate13(current.crystals, lifetimeTime);
    var lifetimeS13 = rate13(current.score, lifetimeTime);
    var rankName = ranks[current.rank] || "Rank " + current.rank;

    elements["rank-token"].textContent = current.rank || "—";
    elements["profile-context"].textContent = rankName;
    elements["profile-title"].textContent = current.name || state.currentPlayerId;
    elements["player-meta"].textContent = "Tracked since " + formatDate(player.history && player.history[0] && player.history[0].at) + " · last snapshot " + formatRelativeTime(current.at);
    elements["hero-efficiency"].textContent = formatInteger(current.efficiency);
    elements["hero-position"].textContent = current.efficiencyPosition > 0 ? "Official position #" + formatInteger(current.efficiencyPosition) : "Official position unavailable";
    elements["total-time"].textContent = formatDurationWords(lifetimeTime);
    elements["total-time"].title = formatExactDuration(lifetimeTime);
    elements["period-time"].textContent = period ? formatDurationWords(period.delta.time) + " during selected period" : "Period rate begins after another active snapshot";
    elements["activity-state"].textContent = activityLabel(player);
    elements["stat-kills"].textContent = formatInteger(current.kills);
    elements["delta-kills"].textContent = period ? signed(period.delta.kills) + " selected period" : "— selected period";
    elements["stat-kd"].textContent = formatRate(lifetimeKd);
    elements["period-kd"].textContent = period ? formatRate(safeDivide(period.delta.kills, period.delta.deaths)) + " selected period" : "— selected period";
    elements["stat-k13"].textContent = formatRate(lifetimeK13);
    elements["period-k13"].textContent = period && period.delta.time > 0 ? formatRate(rate13(period.delta.kills, period.delta.time)) + " selected period" : "Lifetime rate";
    elements["stat-c13"].textContent = formatRate(lifetimeC13);
    elements["period-crystals"].textContent = period ? signed(period.delta.crystals) + " selected period" : "— selected period";
    elements["stat-s13"].textContent = formatRate(lifetimeS13);
    elements["period-score"].textContent = period ? signed(period.delta.score) + " selected period" : "— selected period";

    renderTrend();
    renderEquipmentSummary(player);
    renderEquipmentList(player);
    renderActivity(player);
    renderAccountDetails(player);
  }

  function calculatePeriod(player) {
    var points = periodPoints(player);
    if (points.length < 2) return null;
    var first = points[0];
    var last = points[points.length - 1];
    if (first.at === last.at) return null;
    return {
      first: first,
      last: last,
      delta: {
        kills: Math.max(0, positive(last.k) - positive(first.k)),
        deaths: Math.max(0, positive(last.d) - positive(first.d)),
        crystals: Math.max(0, positive(last.c) - positive(first.c)),
        score: Math.max(0, positive(last.s) - positive(first.s)),
        golds: Math.max(0, positive(last.g) - positive(first.g)),
        time: Math.max(0, positive(last.t) - positive(first.t))
      }
    };
  }

  function periodPoints(player) {
    var history = Array.isArray(player.history) ? player.history.slice() : [];
    var currentPoint = pointFromCurrent(player.current);
    if (!history.length || history[history.length - 1].at !== currentPoint.at) history.push(currentPoint);
    history.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    if (state.period === "all" || !history.length) return history;
    var end = parseDate(history[history.length - 1].at);
    var cutoff = end.getTime() - Number(state.period) * DAY_MS;
    var firstBefore = null;
    var filtered = history.filter(function (point) {
      var time = parseDate(point.at).getTime();
      if (time < cutoff) firstBefore = point;
      return time >= cutoff;
    });
    if (firstBefore) filtered.unshift(firstBefore);
    return filtered;
  }

  function pointFromCurrent(current) {
    return {
      at: current.at,
      k: current.kills,
      d: current.deaths,
      c: current.crystals,
      s: current.score,
      g: current.golds,
      e: current.efficiency,
      r: current.rank,
      t: current.totalTimeMs
    };
  }

  function renderTrend() {
    var player = getCurrentPlayer();
    if (!player) return;
    var points = periodPoints(player);
    var key = { score: "s", crystals: "c", kills: "k", time: "t" }[state.metric];
    var label = { score: "score", crystals: "crystals", kills: "kills", time: "battle time" }[state.metric];
    if (points.length < 2) {
      renderChartEmpty("Tracking begins here", "A second changed snapshot is needed to draw the " + label + " trend.");
      return;
    }

    var base = positive(points[0][key]);
    var values = points.map(function (point) { return Math.max(0, positive(point[key]) - base); });
    var max = Math.max.apply(Math, values);
    if (max === 0) {
      renderChartEmpty("No change in this period", "The collector ran, but " + label + " stayed at the same value.");
      return;
    }

    var width = 900;
    var height = 310;
    var pad = { top: 18, right: 18, bottom: 38, left: 72 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var coords = values.map(function (value, index) {
      var x = pad.left + (points.length === 1 ? plotW / 2 : index / (points.length - 1) * plotW);
      var y = pad.top + plotH - value / max * plotH;
      return { x: x, y: y, value: value, at: points[index].at };
    });
    var line = coords.map(function (coord) { return coord.x.toFixed(2) + "," + coord.y.toFixed(2); }).join(" ");
    var area = pad.left + "," + (pad.top + plotH) + " " + line + " " + (pad.left + plotW) + "," + (pad.top + plotH);
    var grid = [0, 0.5, 1].map(function (ratio) {
      var y = pad.top + plotH - ratio * plotH;
      var value = ratio * max;
      return '<line class="chart-grid-line" x1="' + pad.left + '" y1="' + y + '" x2="' + (pad.left + plotW) + '" y2="' + y + '"></line>' +
        '<text class="chart-axis-label" x="' + (pad.left - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + escapeHtml(formatChartValue(value, state.metric)) + '</text>';
    }).join("");
    var dotEvery = Math.max(1, Math.ceil(coords.length / 12));
    var dots = coords.filter(function (_, index) { return index % dotEvery === 0 || index === coords.length - 1; }).map(function (coord) {
      return '<circle class="chart-point" cx="' + coord.x + '" cy="' + coord.y + '" r="3"><title>' + escapeHtml(formatDateTime(coord.at) + " · +" + formatChartValue(coord.value, state.metric)) + '</title></circle>';
    }).join("");
    var startLabel = escapeHtml(shortDate.format(parseDate(points[0].at)));
    var endLabel = escapeHtml(shortDate.format(parseDate(points[points.length - 1].at)));
    elements["trend-chart"].innerHTML = '<svg class="trend-svg" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true" focusable="false">' +
      grid + '<polygon class="chart-area" points="' + area + '"></polygon><polyline class="chart-line" points="' + line + '"></polyline>' + dots +
      '<text class="chart-axis-label" x="' + pad.left + '" y="' + (height - 8) + '">' + startLabel + '</text>' +
      '<text class="chart-axis-label" x="' + (pad.left + plotW) + '" y="' + (height - 8) + '" text-anchor="end">' + endLabel + '</text></svg>';
    elements["trend-chart"].setAttribute("aria-label", label + " increased by " + formatChartValue(max, state.metric) + " across " + points.length + " snapshots.");
    elements["trend-summary"].textContent = "+" + formatChartValue(max, state.metric) + " across " + points.length + " snapshots.";
  }

  function renderChartEmpty(title, body) {
    elements["trend-chart"].innerHTML = '<div class="chart-empty"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(body) + '</span></div>';
    elements["trend-chart"].setAttribute("aria-label", title + ". " + body);
    elements["trend-summary"].textContent = body;
  }

  function renderEquipmentSummary(player) {
    var equipment = player.current.equipment || {};
    var categories = [
      ["hulls", "Hull"], ["turrets", "Turret"], ["drones", "Drone"], ["modes", "Mode"]
    ];
    elements["equipment-summary"].innerHTML = categories.map(function (entry) {
      var favorite = favoriteItem(equipment[entry[0]]);
      return '<div class="favorite-item"><span>' + entry[1] + '</span><strong title="' + escapeAttr(favorite ? favorite.name : "No usage") + '">' +
        escapeHtml(favorite ? favorite.name : "—") + '</strong><span>' + (favorite ? escapeHtml(formatShortDuration(favorite.timeMs)) : "No data") + '</span></div>';
    }).join("");
  }

  function renderEquipmentList(player) {
    if (!player) return;
    var items = ((player.current.equipment || {})[state.equipment] || []).slice().sort(function (a, b) { return positive(b.timeMs) - positive(a.timeMs); }).slice(0, 10);
    if (!items.length) {
      elements["equipment-list"].innerHTML = '<p class="chart-empty">No usage was reported for this category.</p>';
      return;
    }
    var max = positive(items[0].timeMs) || 1;
    elements["equipment-list"].innerHTML = items.map(function (item) {
      var width = Math.max(0.5, positive(item.timeMs) / max * 100);
      return '<div class="usage-row"><span class="usage-name" title="' + escapeAttr(item.name) + '">' + escapeHtml(item.name) + '</span>' +
        '<span class="usage-bar" aria-hidden="true"><span style="transform:scaleX(' + (width / 100).toFixed(4) + ')"></span></span>' +
        '<span class="usage-meta">' + escapeHtml(formatShortDuration(item.timeMs)) + '</span></div>';
    }).join("");
  }

  function renderActivity(player) {
    var points = periodPointsForDays(player, 15);
    var daily = {};
    for (var i = 1; i < points.length; i += 1) {
      var deltaTime = Math.max(0, positive(points[i].t) - positive(points[i - 1].t));
      var key = localDateKey(points[i].at);
      daily[key] = (daily[key] || 0) + deltaTime;
    }
    var days = [];
    var end = parseDate(player.current.at) || new Date();
    for (var offset = 13; offset >= 0; offset -= 1) {
      var date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - offset);
      var dayKey = localDateKey(date.toISOString());
      days.push({ date: date, value: daily[dayKey] || 0 });
    }
    var max = Math.max.apply(Math, days.map(function (day) { return day.value; }).concat([1]));
    elements["activity-chart"].innerHTML = days.map(function (day) {
      var ratio = day.value / max;
      var weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(day.date);
      return '<div class="activity-day" title="' + escapeAttr(shortDate.format(day.date) + " · " + formatDurationWords(day.value)) + '">' +
        '<span class="activity-bar-wrap"><span class="activity-bar" style="height:' + Math.max(day.value ? 3 : 0.5, ratio * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bar-label">' + escapeHtml(weekday) + '</span></div>';
    }).join("");
    var total = days.reduce(function (sum, day) { return sum + day.value; }, 0);
    elements["activity-chart"].setAttribute("aria-label", "Battle time during the last 14 days: " + formatDurationWords(total) + ".");
  }

  function periodPointsForDays(player, days) {
    var savedPeriod = state.period;
    state.period = days;
    var points = periodPoints(player);
    state.period = savedPeriod;
    return points;
  }

  function renderAccountDetails(player) {
    var current = player.current;
    var details = [
      ["Rank", (ranks[current.rank] || "Rank") + " · " + current.rank],
      ["Rank progress", formatInteger(current.score - current.scoreBase) + " / " + formatInteger(Math.max(0, current.scoreNext - current.scoreBase))],
      ["Gear score", formatInteger(current.gearScore)],
      ["Gold boxes", formatInteger(current.golds)],
      ["Premium", current.premium ? "Active" : "Inactive"],
      ["Snapshots", formatInteger((player.history || []).length)]
    ];
    elements["account-details"].innerHTML = details.map(function (detail) {
      return '<div><dt>' + escapeHtml(detail[0]) + '</dt><dd>' + escapeHtml(String(detail[1])) + '</dd></div>';
    }).join("");
  }

  function renderLeaderboard() {
    if (!state.data) return;
    var sort = elements["leaderboard-sort"].value;
    var players = getPlayerIds().map(function (id) { return { id: id, player: state.data.players[id] }; });
    players.sort(function (a, b) { return sortValue(b.player, sort) - sortValue(a.player, sort) || a.player.current.name.localeCompare(b.player.current.name); });
    var labels = {
      efficiency: ["Efficiency", "K/D"], score: ["Score", "Efficiency"], kd: ["K/D", "Kills"],
      kills13: ["Kills / 13m", "K/D"], time: ["Battle time", "Efficiency"]
    }[sort];
    var html = '<div class="leaderboard-head" aria-hidden="true"><span>#</span><span>Player</span><span style="text-align:end">' + labels[0] + '</span><span style="text-align:end">' + labels[1] + '</span></div>';
    html += players.map(function (entry, index) {
      var current = entry.player.current;
      var primary = leaderboardValue(entry.player, sort, true);
      var secondary = leaderboardValue(entry.player, sort, false);
      return '<button class="leaderboard-row" type="button" data-player-id="' + escapeAttr(entry.id) + '">' +
        '<span class="leaderboard-rank">' + (index + 1) + '</span><span class="leaderboard-name"><strong>' + escapeHtml(current.name) + '</strong><span>' + escapeHtml(ranks[current.rank] || "Rank " + current.rank) + '</span></span>' +
        '<span class="leaderboard-value">' + escapeHtml(primary) + '</span><span class="leaderboard-value">' + escapeHtml(secondary) + '</span></button>';
    }).join("");
    elements["leaderboard-list"].innerHTML = html;
  }

  function sortValue(player, sort) {
    var current = player.current;
    if (sort === "score") return positive(current.score);
    if (sort === "kd") return safeDivide(current.kills, current.deaths);
    if (sort === "kills13") return rate13(current.kills, current.totalTimeMs);
    if (sort === "time") return positive(current.totalTimeMs);
    return positive(current.efficiency);
  }

  function leaderboardValue(player, sort, primary) {
    var current = player.current;
    if (!primary) {
      if (sort === "efficiency" || sort === "kills13") return formatRate(safeDivide(current.kills, current.deaths));
      if (sort === "score" || sort === "time") return formatInteger(current.efficiency);
      return formatInteger(current.kills);
    }
    if (sort === "score") return formatInteger(current.score);
    if (sort === "kd") return formatRate(safeDivide(current.kills, current.deaths));
    if (sort === "kills13") return formatRate(rate13(current.kills, current.totalTimeMs));
    if (sort === "time") return formatShortDuration(current.totalTimeMs);
    return formatInteger(current.efficiency);
  }

  function renderComparePicker() {
    if (!state.data) return;
    elements["compare-picker"].innerHTML = getPlayerIds().map(function (id) {
      var selected = state.compare.indexOf(id) >= 0;
      var disabled = !selected && state.compare.length >= 4;
      return '<button class="compare-chip' + (selected ? " is-selected" : "") + '" type="button" data-player-id="' + escapeAttr(id) + '" aria-pressed="' + selected + '"' + (disabled ? " disabled" : "") + '>' + escapeHtml(state.data.players[id].current.name) + '</button>';
    }).join("");
  }

  function handleComparePick(event) {
    var button = event.target.closest("button[data-player-id]");
    if (!button) return;
    var id = button.dataset.playerId;
    var index = state.compare.indexOf(id);
    if (index >= 0) state.compare.splice(index, 1);
    else if (state.compare.length < 4) state.compare.push(id);
    renderComparePicker();
    renderComparison();
  }

  function renderComparison() {
    if (!state.data) return;
    if (state.compare.length < 2) {
      elements["compare-empty"].hidden = false;
      elements["comparison"].hidden = true;
      return;
    }
    elements["compare-empty"].hidden = true;
    elements["comparison"].hidden = false;
    var players = state.compare.map(function (id) { return state.data.players[id]; });
    var rows = [
      metricRow("Efficiency", players, function (p) { return positive(p.current.efficiency); }, formatInteger),
      metricRow("K/D", players, function (p) { return safeDivide(p.current.kills, p.current.deaths); }, formatRate),
      metricRow("Kills / 13 min", players, function (p) { return rate13(p.current.kills, p.current.totalTimeMs); }, formatRate),
      metricRow("Battle time", players, function (p) { return positive(p.current.totalTimeMs); }, formatShortDuration),
      metricRow("Score", players, function (p) { return positive(p.current.score); }, formatInteger),
      metricRow("Crystals", players, function (p) { return positive(p.current.crystals); }, formatInteger),
      textRow("Favorite hull", players, function (p) { var item = favoriteItem((p.current.equipment || {}).hulls); return item ? item.name : "—"; }),
      textRow("Favorite turret", players, function (p) { var item = favoriteItem((p.current.equipment || {}).turrets); return item ? item.name : "—"; }),
      textRow("Favorite mode", players, function (p) { var item = favoriteItem((p.current.equipment || {}).modes); return item ? item.name : "—"; })
    ];
    var header = '<div class="compare-metric">Metric</div>' + players.map(function (player) { return '<div class="compare-player">' + escapeHtml(player.current.name) + '</div>'; }).join("");
    elements["comparison"].innerHTML = '<div class="comparison-grid" style="--compare-count:' + players.length + '">' + header + rows.join("") + '</div>';
  }

  function metricRow(label, players, getter, formatter) {
    var values = players.map(getter);
    var max = Math.max.apply(Math, values.concat([1]));
    return '<div class="compare-metric">' + escapeHtml(label) + '</div>' + values.map(function (value) {
      return '<div><span class="compare-value">' + escapeHtml(formatter(value)) + '</span><span class="compare-bar" aria-hidden="true" style="display:block;transform:scaleX(' + Math.max(0, value / max).toFixed(4) + ')"></span></div>';
    }).join("");
  }

  function textRow(label, players, getter) {
    return '<div class="compare-metric">' + escapeHtml(label) + '</div>' + players.map(function (player) {
      return '<div class="compare-value">' + escapeHtml(getter(player)) + '</div>';
    }).join("");
  }

  function navigateToView(view) {
    if (view === "profile") {
      var player = getCurrentPlayer();
      window.location.hash = player ? "player/" + encodeURIComponent(player.current.name) : "profile";
    } else {
      window.location.hash = view;
    }
  }

  function applyRoute() {
    if (!state.data || !getPlayerIds().length) return;
    var hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (hash.indexOf("player/") === 0) {
      var name = hash.slice(7).toLowerCase();
      var match = getPlayerIds().find(function (id) {
        return id.toLowerCase() === name || state.data.players[id].current.name.toLowerCase() === name;
      });
      if (match) state.currentPlayerId = match;
      setView("profile");
    } else if (hash === "leaderboard" || hash === "compare") {
      setView(hash);
    } else {
      setView("profile");
    }
    renderProfile();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("[data-view-panel]").forEach(function (panel) {
      var active = panel.dataset.viewPanel === view;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.view === view);
      if (button.matches(".nav-button")) button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function selectPlayer(id) {
    if (!state.data.players[id]) return;
    state.currentPlayerId = id;
    closeDialog(elements["search-dialog"]);
    window.location.hash = "player/" + encodeURIComponent(state.data.players[id].current.name);
  }

  function openSearch() {
    state.searchIndex = 0;
    elements["player-search"].value = "";
    renderSearchResults();
    openDialog(elements["search-dialog"]);
    window.setTimeout(function () { elements["player-search"].focus(); }, 0);
  }

  function renderSearchResults() {
    if (!state.data) return;
    var query = (elements["player-search"].value || "").trim().toLowerCase();
    var matches = getPlayerIds().filter(function (id) {
      return state.data.players[id].current.name.toLowerCase().indexOf(query) >= 0;
    }).slice(0, 20);
    state.searchIndex = Math.max(0, Math.min(state.searchIndex, matches.length - 1));
    if (!matches.length) {
      elements["search-results"].innerHTML = '<div class="chart-empty"><strong>No tracked player found</strong><span>Add the username to data/players.json, then run the tracker workflow.</span></div>';
      return;
    }
    elements["search-results"].innerHTML = matches.map(function (id, index) {
      var current = state.data.players[id].current;
      return '<button class="search-result' + (index === state.searchIndex ? " is-active" : "") + '" type="button" role="option" aria-selected="' + (index === state.searchIndex) + '" data-player-id="' + escapeAttr(id) + '"><strong>' + escapeHtml(current.name) + '</strong><span>' + escapeHtml(ranks[current.rank] || "Rank " + current.rank) + '</span></button>';
    }).join("");
  }

  function handleSearchKeys(event) {
    var results = elements["search-results"].querySelectorAll("button[data-player-id]");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      state.searchIndex = (state.searchIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      renderSearchResults();
      var active = elements["search-results"].querySelector(".is-active");
      if (active) active.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && results.length) {
      event.preventDefault();
      var selected = elements["search-results"].querySelector(".is-active") || results[0];
      selectPlayer(selected.dataset.playerId);
    }
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function exportTracker() {
    if (!state.data) return;
    downloadJson(state.data, "tanki-tracker-backup-" + fileDate(new Date()) + ".json");
  }

  function importTracker(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    elements["import-status"].textContent = "Reading backup…";
    elements["import-status"].dataset.state = "loading";
    file.text().then(function (text) {
      var imported = validateTracker(JSON.parse(text));
      return saveImportedData(imported).then(function (persisted) {
        state.data = imported;
        state.localMode = true;
        state.currentPlayerId = getPlayerIds()[0] || null;
        state.compare = [];
        elements["import-status"].textContent = persisted ? "Backup loaded and saved in this browser." : "Backup loaded for this tab. This browser could not store it permanently.";
        elements["import-status"].dataset.state = "success";
        finishLoading();
      });
    }).catch(function (error) {
      elements["import-status"].textContent = "Import failed. " + (error.message || "Choose an exported tracker JSON file.");
      elements["import-status"].dataset.state = "error";
    }).finally(function () {
      event.target.value = "";
    });
  }

  function clearImportedData() {
    deleteImportedData().finally(function () {
      if (!state.siteData) return;
      state.data = state.siteData;
      state.localMode = false;
      state.currentPlayerId = getPlayerIds()[0] || null;
      state.compare = [];
      renderAll();
      applyRoute();
    });
  }

  function exportProfileCsv() {
    var player = getCurrentPlayer();
    if (!player) return;
    var rows = [["timestamp", "kills", "deaths", "crystals", "score", "golds", "efficiency", "rank", "battle_time_ms"]];
    periodPoints(player).forEach(function (point) {
      rows.push([point.at, point.k, point.d, point.c, point.s, point.g, point.e, point.r, point.t]);
    });
    var csv = rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
    downloadBlob(csv, player.current.name.toLowerCase() + "-history-" + fileDate(new Date()) + ".csv", "text/csv;charset=utf-8");
  }

  function saveImportedData(data) {
    return openDatabase().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(data, "active");
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }

  function loadImportedData() {
    return openDatabase().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, "readonly");
        var request = tx.objectStore(STORE_NAME).get("active");
        request.onsuccess = function () { resolve(request.result ? validateTracker(request.result) : null); };
        request.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function deleteImportedData() {
    return openDatabase().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete("active");
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    });
  }

  function openDatabase() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function downloadJson(data, name) {
    downloadBlob(JSON.stringify(data, null, 2) + "\n", name, "application/json");
  }

  function downloadBlob(content, name, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showToast(message) {
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    elements["toast-region"].appendChild(toast);
    var timer = window.setTimeout(remove, 6000);
    toast.addEventListener("mouseenter", function () { window.clearTimeout(timer); });
    toast.addEventListener("mouseleave", function () { timer = window.setTimeout(remove, 2500); });
    function remove() { if (toast.parentNode) toast.remove(); }
  }

  function setActiveButton(container, active, selector) {
    container.querySelectorAll("button").forEach(function (button) { button.classList.remove(selector.replace(".", "")); });
    active.classList.add(selector.replace(".", ""));
  }

  function favoriteItem(items) {
    return Array.isArray(items) && items.length ? items.slice().sort(function (a, b) { return positive(b.timeMs) - positive(a.timeMs); })[0] : null;
  }

  function activityLabel(player) {
    var history = Array.isArray(player.history) ? player.history : [];
    if (history.length < 2) return "Tracking begins with this snapshot";
    for (var i = history.length - 1; i > 0; i -= 1) {
      if (positive(history[i].t) > positive(history[i - 1].t)) return "Last activity " + formatRelativeTime(history[i].at);
    }
    return "No recorded activity change";
  }

  function formatInteger(value) {
    return Number.isFinite(Number(value)) ? number.format(Number(value)) : "—";
  }

  function formatRate(value) {
    if (value === Infinity) return "∞";
    return Number.isFinite(Number(value)) ? decimal.format(Number(value)) : "—";
  }

  function formatChartValue(value, metric) {
    if (metric === "time") return formatShortDuration(value);
    return Math.abs(value) >= 10000 ? shortNumber.format(value) : number.format(Math.round(value));
  }

  function formatDurationWords(ms) {
    ms = positive(ms);
    var totalMinutes = Math.floor(ms / 60000);
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;
    if (days) return days + " " + plural(days, "day") + " " + hours + " " + plural(hours, "hour") + " " + minutes + " " + plural(minutes, "minute");
    if (hours) return hours + " " + plural(hours, "hour") + " " + minutes + " " + plural(minutes, "minute");
    return minutes + " " + plural(minutes, "minute");
  }

  function formatExactDuration(ms) {
    ms = positive(ms);
    var seconds = Math.floor(ms / 1000) % 60;
    return formatDurationWords(ms) + " " + seconds + " " + plural(seconds, "second");
  }

  function formatShortDuration(ms) {
    ms = positive(ms);
    var minutes = Math.floor(ms / 60000);
    if (minutes >= 1440) return decimal.format(minutes / 1440) + "d";
    if (minutes >= 60) return decimal.format(minutes / 60) + "h";
    return number.format(minutes) + "m";
  }

  function formatDate(value) {
    var date = parseDate(value);
    return date ? shortDate.format(date) : "first snapshot";
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    return date ? dateTime.format(date) : "unknown time";
  }

  function formatRelativeTime(value) {
    var date = parseDate(value);
    if (!date) return "at an unknown time";
    var seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function parseDate(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(value) {
    var date = parseDate(value);
    if (!date) return "unknown";
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function rate13(amount, timeMs) {
    timeMs = positive(timeMs);
    return timeMs > 0 ? positive(amount) * MS_13_MINUTES / timeMs : NaN;
  }

  function safeDivide(a, b) {
    a = positive(a);
    b = positive(b);
    if (b === 0) return a > 0 ? Infinity : NaN;
    return a / b;
  }

  function positive(value) {
    var result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : 0;
  }

  function signed(value) {
    value = Number(value);
    if (!Number.isFinite(value)) return "—";
    return (value > 0 ? "+" : "") + number.format(value);
  }

  function plural(value, word) {
    return value === 1 ? word : word + "s";
  }

  function fileDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function csvCell(value) {
    var text = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
