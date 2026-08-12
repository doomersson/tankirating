(function () {
  "use strict";

  var MS_13_MINUTES = 13 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var HOUR_MS = 60 * 60 * 1000;
  var RATING_TIME_ZONE = viewerTimeZone();
  var RATING_RESET_HOUR = 4;
  var DATA_URL = "./data/tracker.json";
  var REPOSITORY = "doomersson/tankirating";
  var DB_NAME = "tanki-tracker-backups";
  var STORE_NAME = "imports";
  var number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var decimal = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  var shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  var ratingDate = new Intl.DateTimeFormat(undefined, { timeZone: RATING_TIME_ZONE, year: "numeric", month: "short", day: "numeric" });
  var ratingClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: RATING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  var rankThresholds = [
    ["Recruit", 0], ["Private", 100], ["Gefreiter", 500], ["Corporal", 1500],
    ["Master Corporal", 3700], ["Sergeant", 7100], ["Staff Sergeant", 12300],
    ["Master Sergeant", 20000], ["First Sergeant", 29000], ["Sergeant-Major", 41000],
    ["Warrant Officer 1", 57000], ["Warrant Officer 2", 76000], ["Warrant Officer 3", 98000],
    ["Warrant Officer 4", 125000], ["Warrant Officer 5", 156000], ["Third Lieutenant", 192000],
    ["Second Lieutenant", 233000], ["First Lieutenant", 280000], ["Captain", 332000],
    ["Major", 390000], ["Lieutenant Colonel", 455000], ["Colonel", 527000],
    ["Brigadier", 606000], ["Major General", 692000], ["Lieutenant General", 787000],
    ["General", 889000], ["Marshal", 1000000], ["Field Marshal", 1122000],
    ["Commander", 1255000], ["Generalissimo", 1400000], ["Legend", 1600000]
  ];

  var state = {
    data: null,
    siteData: null,
    localMode: false,
    currentPlayerId: null,
    view: "leaderboard",
    period: "day",
    selectedRatingDate: null,
    equipment: "hulls",
    compare: [],
    compareQuery: "",
    searchIndex: 0,
    leaderboardSort: "kills13",
    leaderboardDirection: "desc",
    leaderboardPeriod: 7,
    timeUnit: "exact"
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    state.timeUnit = readTimeUnit();
    syncTimeUnitControls();
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
      "rank-fallback", "rank-icon", "rank-progress-text", "rank-progress-percent", "rank-progress-bar",
      "profile-title", "player-meta", "hero-efficiency", "hero-position", "total-time",
      "time-heading",
      "period-time", "activity-state", "stat-kills", "delta-kills", "stat-kd", "period-kd",
      "stat-k13", "period-k13", "stat-c13", "period-crystals", "stat-s13", "period-score",
      "rating-date", "rating-reset-note", "range-kd-label", "stat-range-kd", "range-kd-detail",
      "stat-kills-hour", "kills-hour-detail", "stat-crystals-hour", "crystals-hour-detail",
      "stat-score-hour", "score-hour-detail",
      "equipment-summary", "equipment-list", "activity-chart", "activity-zone-note",
      "account-details", "leaderboard-count", "leaderboard-sort-strip", "leaderboard-list", "compare-search", "compare-picker-status",
      "compare-picker", "compare-empty",
      "comparison", "global-empty", "footer-sync", "search-trigger", "mobile-search", "search-dialog",
      "player-search", "search-results", "search-request-area", "tools-trigger", "tools-dialog", "export-data", "import-data",
      "import-trigger", "import-status", "profile-csv", "refresh-player", "toast-region"
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
      state.period = button.dataset.period === "30" ? 30 : button.dataset.period;
      syncProfilePeriodControls();
      renderProfile();
      renderComparison();
    });

    elements["rating-date"].addEventListener("change", function (event) {
      if (!validDateKey(event.currentTarget.value)) return;
      state.selectedRatingDate = event.currentTarget.value;
      state.period = "day";
      syncProfilePeriodControls();
      renderProfile();
      renderComparison();
    });

    document.getElementById("leaderboard-period-control").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-leaderboard-period]");
      if (!button) return;
      state.leaderboardPeriod = button.dataset.leaderboardPeriod === "all" ? "all" : Number(button.dataset.leaderboardPeriod);
      setActiveButton(event.currentTarget, button, ".is-active");
      renderLeaderboard();
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

    document.querySelectorAll("[data-time-unit]").forEach(function (button) {
      button.addEventListener("click", function () { setTimeUnit(button.dataset.timeUnit); });
    });
    document.addEventListener("error", function (event) {
      var image = event.target;
      if (!image || image.tagName !== "IMG") return;
      if (image.dataset.fallbackIcon) {
        if (image.dataset.fallbackApplied === "true") image.remove();
        else {
          image.dataset.fallbackApplied = "true";
          image.src = image.dataset.fallbackIcon;
        }
        return;
      }
      if (image.src.indexOf("/assets/ranks/") < 0) return;
      if (image.id === "rank-icon") image.hidden = true;
      else image.remove();
    }, true);
    elements["rank-icon"].addEventListener("load", function () { elements["rank-icon"].hidden = false; });
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
      var sortButton = event.target.closest("button[data-sort]");
      if (sortButton) {
        setLeaderboardSort(sortButton.dataset.sort);
        return;
      }
      var item = event.target.closest("button[data-player-id]");
      if (item) selectPlayer(item.dataset.playerId);
    });
    elements["leaderboard-sort-strip"].addEventListener("click", function (event) {
      var button = event.target.closest("button[data-sort]");
      if (button) setLeaderboardSort(button.dataset.sort);
    });
    elements["compare-search"].addEventListener("input", function (event) {
      state.compareQuery = event.currentTarget.value.trim().toLowerCase();
      renderComparePicker();
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
    configureRatingCalendar(player);
    var period = calculatePeriod(player);
    var periodName = profilePeriodName();
    var periodCopy = period ? periodName.toLowerCase() : "selected rating period";
    var lifetimeTime = positive(current.totalTimeMs);
    var lifetimeKd = safeDivide(current.kills, current.deaths);
    var lifetimeK13 = rate13(current.kills, lifetimeTime);
    var lifetimeC13 = rate13(current.crystals, lifetimeTime);
    var lifetimeS13 = rate13(current.score, lifetimeTime);
    var rank = rankInfo(current.score);

    elements["rank-fallback"].textContent = rank.number;
    elements["rank-icon"].hidden = false;
    elements["rank-icon"].src = rankIconUrl(rank.iconNumber);
    elements["profile-context"].textContent = rank.name;
    elements["profile-title"].textContent = current.name || state.currentPlayerId;
    elements["player-meta"].textContent = "Tracked since " + formatDate(player.history && player.history[0] && player.history[0].at) + " · last snapshot " + formatRelativeTime(current.at);
    elements["rank-progress-text"].textContent = formatInteger(rank.progressScore) + " / " + formatInteger(rank.span) + " EXP";
    elements["rank-progress-percent"].textContent = formatRate(rank.progressPercent) + "%";
    elements["rank-progress-bar"].value = rank.progressPercent;
    elements["rank-progress-bar"].textContent = formatRate(rank.progressPercent) + "%";
    elements["hero-efficiency"].textContent = formatInteger(current.efficiency);
    elements["hero-position"].textContent = current.efficiencyPosition > 0 ? "Efficiency rank #" + formatInteger(current.efficiencyPosition) : "Efficiency rank unavailable";
    elements["refresh-player"].href = requestIssueUrl("Refresh", current.name);
    elements["time-heading"].textContent = "Hours Played";
    elements["total-time"].textContent = formatDurationDisplay(lifetimeTime);
    elements["total-time"].title = formatExactDuration(lifetimeTime);
    elements["period-time"].textContent = period ? formatDurationDisplay(period.delta.time) + " during " + periodCopy : "This date needs two collected snapshots";
    elements["activity-state"].textContent = activityLabel(player);
    elements["stat-kills"].textContent = formatInteger(current.kills);
    elements["delta-kills"].textContent = period ? signed(period.delta.kills) + " during " + periodCopy : "— " + periodCopy;
    elements["stat-kd"].textContent = formatRate(lifetimeKd);
    elements["period-kd"].textContent = period ? formatRate(safeDivide(period.delta.kills, period.delta.deaths)) + " during " + periodCopy : "— " + periodCopy;
    elements["stat-k13"].textContent = formatRate(lifetimeK13);
    elements["period-k13"].textContent = period && period.delta.time > 0 ? formatRate(rate13(period.delta.kills, period.delta.time)) + " during " + periodCopy : "Lifetime rate";
    elements["stat-c13"].textContent = formatRate(lifetimeC13);
    elements["period-crystals"].textContent = period ? signed(period.delta.crystals) + " during " + periodCopy : "— " + periodCopy;
    elements["stat-s13"].textContent = formatRate(lifetimeS13);
    elements["period-score"].textContent = period ? signed(period.delta.score) + " during " + periodCopy : "— " + periodCopy;
    renderPeriodRates(period, periodName);

    renderEquipmentSummary(player);
    renderEquipmentList(player);
    renderActivity(player);
    renderAccountDetails(player);
  }

  function calculatePeriod(player) {
    if (state.period === "all") return calculatePeriodFor(player, "all");
    var currentKey = state.selectedRatingDate || currentRatingDateKey(player);
    var startKey;
    var endKey;
    if (state.period === "day") {
      startKey = state.selectedRatingDate || currentKey;
      endKey = shiftDateKey(startKey, 1);
    } else if (state.period === "week") {
      startKey = mondayDateKey(currentKey);
      endKey = shiftDateKey(startKey, 7);
    } else {
      startKey = shiftDateKey(currentKey, -29);
      endKey = shiftDateKey(currentKey, 1);
    }
    return calculatePeriodBetween(player, ratingBoundaryMs(startKey), ratingBoundaryMs(endKey));
  }

  function renderPeriodRates(period, periodName) {
    var hasTime = period && period.delta.time > 0;
    var rateDetail = period ? formatDurationDisplay(period.delta.time) + " played" : "No complete snapshot range";
    elements["range-kd-label"].textContent = periodName + " K/D";
    elements["stat-range-kd"].textContent = period ? formatRate(safeDivide(period.delta.kills, period.delta.deaths)) : "—";
    elements["range-kd-detail"].textContent = period ? formatInteger(period.delta.kills) + " K · " + formatInteger(period.delta.deaths) + " D" : rateDetail;
    elements["stat-kills-hour"].textContent = hasTime ? formatRate(rateHour(period.delta.kills, period.delta.time)) : "—";
    elements["kills-hour-detail"].textContent = rateDetail;
    elements["stat-crystals-hour"].textContent = hasTime ? formatRate(rateHour(period.delta.crystals, period.delta.time)) : "—";
    elements["crystals-hour-detail"].textContent = rateDetail;
    elements["stat-score-hour"].textContent = hasTime ? formatRate(rateHour(period.delta.score, period.delta.time)) : "—";
    elements["score-hour-detail"].textContent = rateDetail;
  }

  function calculatePeriodBetween(player, startMs, endMs) {
    var points = allPlayerPoints(player);
    if (points.length < 2 || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    var latestMs = parseDate(points[points.length - 1].at).getTime();
    var effectiveEnd = Math.min(endMs, latestMs);
    if (effectiveEnd <= startMs) return null;
    var first = nearestPoint(points, startMs, effectiveEnd, 90 * 60 * 1000);
    var last = endMs > latestMs ? points[points.length - 1] : nearestPoint(points, endMs, Infinity, 90 * 60 * 1000);
    if (!first || !last || parseDate(last.at).getTime() <= parseDate(first.at).getTime()) return null;
    return periodDelta(first, last);
  }

  function nearestPoint(points, targetMs, maximumMs, maximumDistanceMs) {
    var nearest = null;
    var nearestDistance = Infinity;
    points.forEach(function (point) {
      var time = parseDate(point.at);
      if (!time || time.getTime() > maximumMs) return;
      var distance = Math.abs(time.getTime() - targetMs);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    });
    return nearestDistance <= maximumDistanceMs ? nearest : null;
  }

  function periodDelta(first, last) {
    return {
      first: first,
      last: last,
      delta: {
        efficiency: Number(last.e || 0) - Number(first.e || 0),
        kills: Math.max(0, positive(last.k) - positive(first.k)),
        deaths: Math.max(0, positive(last.d) - positive(first.d)),
        crystals: Math.max(0, positive(last.c) - positive(first.c)),
        score: Math.max(0, positive(last.s) - positive(first.s)),
        golds: Math.max(0, positive(last.g) - positive(first.g)),
        time: Math.max(0, positive(last.t) - positive(first.t))
      }
    };
  }

  function calculatePeriodFor(player, period) {
    var points = periodPointsFor(player, period);
    if (points.length < 2) return null;
    var first = points[0];
    var last = points[points.length - 1];
    if (first.at === last.at) return null;
    return periodDelta(first, last);
  }

  function periodPoints(player) {
    if (state.period === "all") return allPlayerPoints(player);
    var period = calculatePeriod(player);
    if (!period) return [];
    var firstMs = parseDate(period.first.at).getTime();
    var lastMs = parseDate(period.last.at).getTime();
    return allPlayerPoints(player).filter(function (point) {
      var pointMs = parseDate(point.at).getTime();
      return pointMs >= firstMs && pointMs <= lastMs;
    });
  }

  function periodPointsFor(player, period) {
    var history = allPlayerPoints(player);
    if (period === "all" || !history.length) return history;
    var end = parseDate(history[history.length - 1].at);
    var cutoff = end.getTime() - Number(period) * DAY_MS;
    var firstBefore = null;
    var filtered = history.filter(function (point) {
      var time = parseDate(point.at).getTime();
      if (time < cutoff) firstBefore = point;
      return time >= cutoff;
    });
    if (firstBefore) filtered.unshift(firstBefore);
    return filtered;
  }

  function allPlayerPoints(player) {
    var history = Array.isArray(player.history) ? player.history.slice() : [];
    var currentPoint = pointFromCurrent(player.current);
    if (!history.length || history[history.length - 1].at !== currentPoint.at) history.push(currentPoint);
    return history.filter(function (point) { return parseDate(point.at); }).sort(function (a, b) { return parseDate(a.at) - parseDate(b.at); });
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

  function renderEquipmentSummary(player) {
    var equipment = player.current.equipment || {};
    var categories = [
      ["hulls", "Hull"], ["turrets", "Turret"], ["drones", "Drone"], ["modes", "Mode"]
    ];
    elements["equipment-summary"].innerHTML = categories.map(function (entry) {
      var favorite = favoriteItem(equipment[entry[0]]);
      var artwork = equipmentIconMarkup(entry[0], favorite && favorite.name, "favorite-artwork", 64);
      return '<div class="favorite-item' + (artwork ? ' has-artwork' : '') + '"><span class="favorite-label">' + entry[1] + '</span><strong class="favorite-name" title="' + escapeAttr(favorite ? favorite.name : "No usage") + '">' +
        '<span>' + escapeHtml(favorite ? favorite.name : "—") + '</span></strong><span class="favorite-time">' + (favorite ? escapeHtml(formatDurationDisplay(favorite.timeMs)) : "No data") + '</span>' + artwork + '</div>';
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
      return '<div class="usage-row"><span class="usage-identity">' + equipmentIconMarkup(state.equipment, item.name) + '<span class="usage-name" title="' + escapeAttr(item.name) + '">' + escapeHtml(item.name) + '</span></span>' +
        '<span class="usage-bar" aria-hidden="true"><span style="transform:scaleX(' + (width / 100).toFixed(4) + ')"></span></span>' +
        '<span class="usage-meta">' + escapeHtml(formatDurationDisplay(item.timeMs)) + '</span></div>';
    }).join("");
  }

  function equipmentIconMarkup(category, itemName, modifierClass, size) {
    if (!itemName) return "";
    if (category === "drones") {
      if (modifierClass !== "favorite-artwork") return "";
      return '<span class="equipment-icon equipment-icon--drones favorite-artwork" aria-hidden="true"></span>';
    }
    var fallback = { hulls: "hull", turrets: "turret", modes: "mode" }[category];
    if (!fallback) return "";
    var source = "./assets/icons/" + category + "/" + equipmentIconSlug(itemName) + ".svg";
    var className = "equipment-item-icon" + (modifierClass ? " " + modifierClass : "");
    var dimension = size || 20;
    return '<img class="' + className + '" src="' + escapeAttr(source) + '" data-fallback-icon="./assets/icons/' + fallback + '.svg" alt="" width="' + dimension + '" height="' + dimension + '">';
  }

  function equipmentIconSlug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function renderActivity(player) {
    var points = periodPointsForDays(player, 15);
    var daily = {};
    for (var i = 1; i < points.length; i += 1) {
      var deltaTime = Math.max(0, positive(points[i].t) - positive(points[i - 1].t));
      var key = ratingDateKeyForInstant(points[i].at);
      daily[key] = (daily[key] || 0) + deltaTime;
    }
    var days = [];
    var endKey = currentRatingDateKey(player);
    for (var offset = 13; offset >= 0; offset -= 1) {
      var dayKey = shiftDateKey(endKey, -offset);
      days.push({ key: dayKey, value: daily[dayKey] || 0 });
    }
    elements["activity-chart"].innerHTML = days.map(function (day) {
      var dateLabel = formatDateKeyDayMonth(day.key);
      return '<div class="activity-day" title="' + escapeAttr(dateLabel + " · " + formatDurationDisplay(day.value)) + '">' +
        '<span class="activity-bar-wrap" aria-hidden="true">' + activitySlicesMarkup(day.value) + '</span>' +
        '<span class="bar-label">' + escapeHtml(dateLabel) + '</span></div>';
    }).join("");
    var total = days.reduce(function (sum, day) { return sum + day.value; }, 0);
    elements["activity-chart"].setAttribute("aria-label", "Hours played during the last 14 days: " + formatDurationDisplay(total) + ".");
  }

  function activitySlicesMarkup(timeMs) {
    var hours = Math.min(24, positive(timeMs) / 3600000);
    var slices = [];
    for (var hour = 0; hour < 24; hour += 1) {
      var fill = Math.max(0, Math.min(1, hours - hour));
      var fillStep = Math.round(fill * 4) * 25;
      slices.push('<span class="activity-slice fill-' + fillStep + '"></span>');
    }
    return slices.join("");
  }

  function periodPointsForDays(player, days) {
    return periodPointsFor(player, days);
  }

  function renderAccountDetails(player) {
    var current = player.current;
    var rank = rankInfo(current.score);
    var details = [
      ["Rank", rank.name],
      ["EXP progress", formatRate(rank.progressPercent) + "% · " + formatInteger(rank.progressScore) + " / " + formatInteger(rank.span)],
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
    var sort = state.leaderboardSort;
    var direction = state.leaderboardDirection;
    var players = getPlayerIds().map(function (id) {
      var player = state.data.players[id];
      return { id: id, player: player, metrics: leaderboardMetrics(player) };
    });
    players.sort(function (a, b) {
      var aValue = sortValue(a.metrics, sort);
      var bValue = sortValue(b.metrics, sort);
      if (aValue === null && bValue === null) return a.player.current.name.localeCompare(b.player.current.name);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (aValue === bValue) return a.player.current.name.localeCompare(b.player.current.name);
      return direction === "asc" ? (aValue > bValue ? 1 : -1) : (bValue > aValue ? 1 : -1);
    });
    var columns = leaderboardColumns();
    var allTime = state.leaderboardPeriod === "all";
    var periodLabel = leaderboardPeriodLabel();
    elements["leaderboard-count"].textContent = formatInteger(players.length);
    elements["leaderboard-sort-strip"].innerHTML = columns.map(function (column) {
      var active = sort === column.key;
      var sortLabel = active ? (direction === "desc" ? "descending" : "ascending") : "not sorted";
      return '<button type="button" data-sort="' + column.key + '" class="' + (active ? "is-active" : "") + '" aria-pressed="' + active + '" aria-label="' + escapeAttr(column.label + ", " + sortLabel) + '">' + escapeHtml(column.shortLabel || column.label) + (active ? '<span aria-hidden="true">' + (direction === "desc" ? "↓" : "↑") + '</span>' : "") + '</button>';
    }).join("");

    var head = columns.map(function (column) {
      var active = sort === column.key;
      return '<th scope="col" aria-sort="' + (active ? (direction === "desc" ? "descending" : "ascending") : "none") + '"><button class="leaderboard-sort-button' + (active ? " is-active" : "") + '" type="button" data-sort="' + column.key + '">' + escapeHtml(column.label) + (active ? '<span aria-hidden="true">' + (direction === "desc" ? "↓" : "↑") + '</span>' : "") + '</button></th>';
    }).join("");
    var rows = players.map(function (entry, index) {
      var current = entry.player.current;
      var metrics = entry.metrics;
      var rank = rankInfo(current.score);
      return '<tr><td class="leaderboard-order" data-label="Group #">' + (index + 1) + '</td>' +
        '<td class="leaderboard-player-cell" data-label="Player"><button class="leaderboard-player" type="button" data-player-id="' + escapeAttr(entry.id) + '">' + rankBadgeMarkup(rank) + '<span><strong>' + escapeHtml(current.name) + '</strong><small>' + escapeHtml(rank.name) + '</small></span></button></td>' +
        '<td data-label="Efficiency"><span class="leaderboard-efficiency"><strong>' + escapeHtml(formatLeaderboardInteger(metrics.efficiency, allTime)) + '</strong><small>' + (current.efficiencyPosition > 0 ? "#" + escapeHtml(formatInteger(current.efficiencyPosition)) : "Unranked") + '</small></span></td>' +
        '<td data-label="Score">' + escapeHtml(formatLeaderboardInteger(metrics.score, allTime)) + '</td>' +
        '<td data-label="Crystals">' + escapeHtml(formatLeaderboardInteger(metrics.crystals, allTime)) + '</td>' +
        '<td data-label="Kills / 13m">' + escapeHtml(formatRate(metrics.kills13)) + '</td>' +
        '<td data-label="Kills">' + escapeHtml(formatLeaderboardInteger(metrics.kills, allTime)) + '</td>' +
        '<td data-label="Deaths">' + escapeHtml(formatLeaderboardInteger(metrics.deaths, allTime)) + '</td>' +
        '<td data-label="K/D">' + escapeHtml(formatRate(metrics.kd)) + '</td>' +
        '<td data-label="Golds">' + escapeHtml(formatLeaderboardInteger(metrics.golds, allTime)) + '</td>' +
        '<td data-label="Hours Played"' + (Number.isFinite(metrics.time) ? ' title="' + escapeAttr(formatExactDuration(metrics.time)) + '"' : "") + '>' + escapeHtml(formatHoursPlayed(metrics.time)) + '</td></tr>';
    }).join("");
    elements["leaderboard-list"].innerHTML = '<div class="leaderboard-table-wrap"><table><caption class="sr-only">Tracked player statistics for ' + escapeHtml(periodLabel) + ', sorted by ' + escapeHtml(columns.find(function (column) { return column.key === sort; }).label) + (direction === "desc" ? " from highest to lowest." : " from lowest to highest.") + '</caption><thead><tr><th scope="col">#</th><th scope="col">Player</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function leaderboardColumns() {
    return [
      { key: "efficiency", label: "Efficiency" },
      { key: "score", label: "Score" },
      { key: "crystals", label: "Crystals" },
      { key: "kills13", label: "Kills / 13m", shortLabel: "K/13m" },
      { key: "kills", label: "Kills" },
      { key: "deaths", label: "Deaths" },
      { key: "kd", label: "K/D" },
      { key: "golds", label: "Golds" },
      { key: "time", label: "Hours Played", shortLabel: "Hours" }
    ];
  }

  function leaderboardMetrics(player) {
    var current = player.current;
    if (state.leaderboardPeriod === "all") {
      return {
        efficiency: positive(current.efficiency),
        score: positive(current.score),
        crystals: positive(current.crystals),
        kills13: rate13(current.kills, current.totalTimeMs),
        kills: positive(current.kills),
        deaths: positive(current.deaths),
        kd: safeDivide(current.kills, current.deaths),
        golds: positive(current.golds),
        time: positive(current.totalTimeMs)
      };
    }
    var period = calculatePeriodFor(player, state.leaderboardPeriod);
    if (!period) {
      return { efficiency: NaN, score: NaN, crystals: NaN, kills13: NaN, kills: NaN, deaths: NaN, kd: NaN, golds: NaN, time: NaN };
    }
    return {
      efficiency: period.delta.efficiency,
      score: period.delta.score,
      crystals: period.delta.crystals,
      kills13: rate13(period.delta.kills, period.delta.time),
      kills: period.delta.kills,
      deaths: period.delta.deaths,
      kd: safeDivide(period.delta.kills, period.delta.deaths),
      golds: period.delta.golds,
      time: period.delta.time
    };
  }

  function leaderboardPeriodLabel() {
    if (state.leaderboardPeriod === "all") return "all time";
    return state.leaderboardPeriod === 1 ? "the last day" : "the last week";
  }

  function setLeaderboardSort(sort) {
    if (!leaderboardColumns().some(function (column) { return column.key === sort; })) return;
    if (state.leaderboardSort === sort) state.leaderboardDirection = state.leaderboardDirection === "desc" ? "asc" : "desc";
    else {
      state.leaderboardSort = sort;
      state.leaderboardDirection = "desc";
    }
    renderLeaderboard();
  }

  function sortValue(metrics, sort) {
    var value = metrics[sort];
    return Number.isNaN(value) ? null : value;
  }

  function renderComparePicker() {
    if (!state.data) return;
    var ids = getPlayerIds();
    var visible = ids.filter(function (id) {
      var selected = state.compare.indexOf(id) >= 0;
      var name = state.data.players[id].current.name.toLowerCase();
      return selected || !state.compareQuery || name.indexOf(state.compareQuery) >= 0;
    });
    elements["compare-picker-status"].textContent = visible.length + " shown · " + state.compare.length + " selected";
    if (!visible.length) {
      elements["compare-picker"].innerHTML = '<p class="compare-no-results">No tracked player matches that search.</p>';
      return;
    }
    elements["compare-picker"].innerHTML = visible.map(function (id) {
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
      metricRow("Hours Played", players, function (p) { return positive(p.current.totalTimeMs); }, formatHoursPlayed),
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
      setView("leaderboard");
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
    var rawQuery = (elements["player-search"].value || "").trim();
    var query = rawQuery.toLowerCase();
    var matches = getPlayerIds().filter(function (id) {
      return state.data.players[id].current.name.toLowerCase().indexOf(query) >= 0;
    }).slice(0, 20);
    state.searchIndex = Math.max(0, Math.min(state.searchIndex, matches.length - 1));
    if (!matches.length) {
      elements["search-results"].innerHTML = '<div class="chart-empty"><strong>No tracked player found</strong><span>You can request the account below.</span></div>';
    } else {
      elements["search-results"].innerHTML = matches.map(function (id, index) {
        var current = state.data.players[id].current;
        var rank = rankInfo(current.score);
        return '<button class="search-result' + (index === state.searchIndex ? " is-active" : "") + '" type="button" role="option" aria-selected="' + (index === state.searchIndex) + '" data-player-id="' + escapeAttr(id) + '"><strong>' + escapeHtml(current.name) + '</strong><span>' + escapeHtml(rank.name) + '</span></button>';
      }).join("");
    }

    var exact = getPlayerIds().some(function (id) { return state.data.players[id].current.name.toLowerCase() === query; });
    var requestable = /^[A-Za-z0-9_.-]{3,64}$/.test(rawQuery) && !exact;
    elements["search-request-area"].innerHTML = requestable
      ? '<p>GitHub sign-in is the anti-bot gate. NOT_FOUND means the Tanki account is private or does not exist.</p><a class="search-request" href="' + escapeAttr(requestIssueUrl("Track", rawQuery)) + '" target="_blank" rel="noopener"><strong>Request tracking for “' + escapeHtml(rawQuery) + '”</strong></a>'
      : '<p>Enter an exact untracked username to request it. GitHub sign-in provides the anti-bot check.</p>';
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
    } else if (event.key === "Enter") {
      var request = elements["search-request-area"].querySelector("a");
      if (request) {
        event.preventDefault();
        request.click();
      }
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
    container.querySelectorAll("button").forEach(function (button) {
      button.classList.remove(selector.replace(".", ""));
      button.setAttribute("aria-pressed", button === active ? "true" : "false");
    });
    active.classList.add(selector.replace(".", ""));
  }

  function syncProfilePeriodControls() {
    document.querySelectorAll("#period-control button[data-period]").forEach(function (button) {
      var value = button.dataset.period === "30" ? 30 : button.dataset.period;
      var active = value === state.period;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function configureRatingCalendar(player) {
    var points = allPlayerPoints(player);
    var minimum = points.length ? ratingDateKeyForInstant(points[0].at) : currentRatingDateKey(player);
    var maximum = currentRatingDateKey(player);
    if (!validDateKey(state.selectedRatingDate) || state.selectedRatingDate < minimum || state.selectedRatingDate > maximum) {
      state.selectedRatingDate = maximum;
    }
    elements["rating-date"].min = minimum;
    elements["rating-date"].max = maximum;
    elements["rating-date"].value = state.selectedRatingDate;
    elements["rating-date"].disabled = points.length < 2;
    elements["rating-reset-note"].textContent = ratingRangeNote(player);
    elements["activity-zone-note"].textContent = "Hours played by rating day in " + ratingZoneLabel() + ", resetting at 04:00.";
    syncProfilePeriodControls();
  }

  function ratingRangeNote(player) {
    var currentKey = state.selectedRatingDate || currentRatingDateKey(player);
    if (state.period === "day") {
      return formatRatingDateKey(state.selectedRatingDate || currentKey) + " · 04:00–04:00 " + ratingZoneLabel() + " · closest hourly snapshots";
    }
    if (state.period === "week") {
      var monday = mondayDateKey(currentKey);
      return "Mon " + formatRatingDateKey(monday) + " 04:00 – Mon " + formatRatingDateKey(shiftDateKey(monday, 7)) + " 04:00 " + ratingZoneLabel() + " · closest hourly snapshots";
    }
    if (state.period === 30) {
      return formatRatingDateKey(shiftDateKey(currentKey, -29)) + " – " + formatRatingDateKey(currentKey) + " · 04:00 " + ratingZoneLabel() + " · closest hourly snapshots";
    }
    return "All collected snapshots · " + ratingZoneLabel() + " reset boundaries · hourly resolution";
  }

  function profilePeriodName() {
    if (state.period === "day") return "Daily";
    if (state.period === "week") return "Weekly";
    if (state.period === 30) return "30-day";
    return "All-time";
  }

  function readTimeUnit() {
    try {
      var saved = window.localStorage.getItem("tanki-time-unit");
      return ["exact", "hours", "days"].indexOf(saved) >= 0 ? saved : "exact";
    } catch (_) {
      return "exact";
    }
  }

  function setTimeUnit(unit) {
    if (["exact", "hours", "days"].indexOf(unit) < 0) return;
    state.timeUnit = unit;
    try { window.localStorage.setItem("tanki-time-unit", unit); } catch (_) { /* preference remains tab-local */ }
    syncTimeUnitControls();
    renderProfile();
  }

  function syncTimeUnitControls() {
    document.querySelectorAll("[data-time-unit]").forEach(function (button) {
      var active = button.dataset.timeUnit === state.timeUnit;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function rankInfo(score) {
    score = positive(score);
    var legendStart = rankThresholds[30][1];
    if (score >= legendStart) {
      var legendLevel = Math.floor((score - legendStart) / 200000) + 1;
      var legendBase = legendStart + (legendLevel - 1) * 200000;
      var legendProgress = score - legendBase;
      return {
        number: 30 + legendLevel,
        name: legendLevel === 1 ? "Legend" : "Legend " + legendLevel,
        iconNumber: 31,
        progressScore: legendProgress,
        span: 200000,
        progressPercent: legendProgress / 200000 * 100
      };
    }

    var index = 0;
    for (var i = 1; i < rankThresholds.length; i += 1) {
      if (score < rankThresholds[i][1]) break;
      index = i;
    }
    var start = rankThresholds[index][1];
    var next = rankThresholds[index + 1][1];
    var span = Math.max(1, next - start);
    var progress = Math.max(0, score - start);
    return {
      number: index + 1,
      name: rankThresholds[index][0],
      iconNumber: index + 1,
      progressScore: progress,
      span: span,
      progressPercent: Math.min(100, progress / span * 100)
    };
  }

  function rankIconUrl(iconNumber) {
    return "./assets/ranks/" + String(Math.max(1, Math.min(31, iconNumber))).padStart(2, "0") + ".png";
  }

  function rankBadgeMarkup(rank) {
    return '<span class="rank-badge" aria-hidden="true"><span>' + rank.number + '</span><img src="' + rankIconUrl(rank.iconNumber) + '" alt="" width="40" height="40"></span>';
  }

  function requestIssueUrl(action, playerName) {
    var title = "[" + action + " player] " + playerName;
    var body = action === "Track"
      ? "Please verify this Tanki Online account and add it to the public tracker if it exists and is public."
      : "Please collect a fresh snapshot for this tracked Tanki Online account.";
    return "https://github.com/" + REPOSITORY + "/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
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

  function formatLeaderboardInteger(value, allTime) {
    if (!Number.isFinite(Number(value))) return "—";
    return allTime ? formatInteger(value) : signed(value);
  }

  function formatRate(value) {
    if (value === Infinity) return "∞";
    return Number.isFinite(Number(value)) ? decimal.format(Number(value)) : "—";
  }

  function formatDurationDisplay(ms) {
    ms = positive(ms);
    if (state.timeUnit === "hours") return decimal.format(ms / 3600000) + " hours";
    if (state.timeUnit === "days") return decimal.format(ms / DAY_MS) + " days";
    return formatDurationWords(ms);
  }

  function formatHoursPlayed(ms) {
    return Number.isFinite(Number(ms)) ? decimal.format(Math.max(0, Number(ms)) / 3600000) + " h" : "—";
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

  function formatDate(value) {
    var date = parseDate(value);
    return date ? shortDate.format(date) : "first snapshot";
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    return date ? dateTime.format(date) : "unknown time";
  }

  function formatDayMonth(value) {
    var date = value instanceof Date ? value : parseDate(value);
    return date ? date.getDate() + "/" + (date.getMonth() + 1) : "—";
  }

  function formatDateKeyDayMonth(key) {
    if (!validDateKey(key)) return "—";
    var parts = key.split("-");
    return Number(parts[2]) + "/" + Number(parts[1]);
  }

  function formatRatingDateKey(key) {
    if (!validDateKey(key)) return "—";
    return ratingDate.format(new Date(ratingBoundaryMs(key)));
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

  function viewerTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {
      return "UTC";
    }
  }

  function ratingZoneLabel() {
    return RATING_TIME_ZONE === "UTC" ? "UTC" : RATING_TIME_ZONE.replace(/_/g, " ");
  }

  function ratingZoneParts(value) {
    var date = value instanceof Date ? value : parseDate(value);
    if (!date) return null;
    var result = {};
    ratingClock.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") result[part.type] = Number(part.value);
    });
    return result;
  }

  function ratingZoneOffsetMs(date) {
    var parts = ratingZoneParts(date);
    if (!parts) return 0;
    var zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return zonedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  }

  function ratingBoundaryMs(key) {
    if (!validDateKey(key)) return NaN;
    var parts = key.split("-").map(Number);
    var wallClockUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], RATING_RESET_HOUR);
    var candidate = wallClockUtc - ratingZoneOffsetMs(new Date(wallClockUtc));
    return wallClockUtc - ratingZoneOffsetMs(new Date(candidate));
  }

  function ratingDateKeyForInstant(value) {
    var parts = ratingZoneParts(value);
    if (!parts) return "unknown";
    var key = parts.year + "-" + String(parts.month).padStart(2, "0") + "-" + String(parts.day).padStart(2, "0");
    return parts.hour < RATING_RESET_HOUR ? shiftDateKey(key, -1) : key;
  }

  function currentRatingDateKey(player) {
    return ratingDateKeyForInstant(player && player.current && player.current.at ? player.current.at : new Date());
  }

  function shiftDateKey(key, days) {
    if (!validDateKey(key)) return "unknown";
    var parts = key.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days, 12));
    return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
  }

  function mondayDateKey(key) {
    if (!validDateKey(key)) return key;
    var parts = key.split("-").map(Number);
    var weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)).getUTCDay();
    return shiftDateKey(key, -((weekday + 6) % 7));
  }

  function validDateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return false;
    var parts = key.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2];
  }

  function rate13(amount, timeMs) {
    timeMs = positive(timeMs);
    return timeMs > 0 ? positive(amount) * MS_13_MINUTES / timeMs : NaN;
  }

  function rateHour(amount, timeMs) {
    timeMs = positive(timeMs);
    return timeMs > 0 ? positive(amount) * HOUR_MS / timeMs : NaN;
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
