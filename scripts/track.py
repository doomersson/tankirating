#!/usr/bin/env python3
"""Collect compact Tanki Ratings snapshots for a static GitHub Pages site."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "players.json"
TRACKER_PATH = ROOT / "data" / "tracker.json"
SCHEMA_VERSION = 1
USER_AGENT = "TankiTrackerPages/1.0 (+GitHub Actions; community statistics)"
RATING_TIME_ZONE = ZoneInfo("Europe/Stockholm")
RATING_RESET_HOUR = 4


class ProfileNotFoundError(ValueError):
    """The ratings API reports that a profile is private or does not exist."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_time(value: datetime | None = None) -> str:
    return (value or utc_now()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def rating_day(value: datetime) -> str:
    """Return the Tanki rating-day key for a UTC instant in Stockholm time."""
    local = value.astimezone(RATING_TIME_ZONE)
    if local.hour < RATING_RESET_HOUR:
        local -= timedelta(days=1)
    return local.date().isoformat()


def number_value(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def load_json(path: Path, fallback: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
    os.replace(temporary, path)


def validate_config(config: dict[str, Any]) -> dict[str, Any]:
    raw_players = config.get("players")
    if not isinstance(raw_players, list):
        raise ValueError("data/players.json must contain a players array.")

    names: list[str] = []
    seen: set[str] = set()
    for raw_name in raw_players:
        name = str(raw_name).strip()
        key = name.casefold()
        if not name or key in seen:
            continue
        if len(name) > 64:
            raise ValueError(f"Player name is too long: {name[:24]}…")
        seen.add(key)
        names.append(name)

    if len(names) > 100:
        raise ValueError("This static tracker intentionally supports at most 100 configured players.")

    return {
        "players": names,
        "region": str(config.get("region", "eu")).strip().lower() or "eu",
        "language": str(config.get("language", "en")).strip().lower() or "en",
        "concurrency": max(1, min(6, number_value(config.get("concurrency"), 4))),
        "retentionDays": max(30, min(3650, number_value(config.get("retentionDays"), 730))),
    }


def build_url(username: str, region: str, language: str) -> str:
    query = urllib.parse.urlencode({"user": username, "lang": language})
    return f"https://ratings.tankionline.com/api/{urllib.parse.quote(region)}/profile/?{query}"


def fetch_profile(username: str, region: str, language: str) -> dict[str, Any]:
    url = build_url(username, region, language)
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = json.loads(response.read().decode("utf-8"))
            profile = payload.get("response") if isinstance(payload, dict) else None
            if not isinstance(profile, dict) or not profile.get("name"):
                response_type = payload.get("responseType") if isinstance(payload, dict) else None
                if response_type == "NOT_FOUND":
                    raise ProfileNotFoundError(
                        f"{username} is private or does not exist (Tanki Ratings returned NOT_FOUND)."
                    )
                raise ValueError(f"No profile returned ({response_type or 'unknown response'}).")
            return profile
        except ProfileNotFoundError:
            raise
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(str(last_error or "Profile request failed."))


def aggregate_usage(items: Any) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    if not isinstance(items, list):
        return []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "Unknown").strip() or "Unknown"
        key = name.casefold()
        item = grouped.setdefault(
            key,
            {
                "name": name,
                "timeMs": 0,
                "score": 0,
            },
        )
        item["timeMs"] += max(0, number_value(raw.get("timePlayed")))
        item["score"] += max(0, number_value(raw.get("scoreEarned")))
    return sorted(grouped.values(), key=lambda item: (-item["timeMs"], item["name"].casefold()))


def first_usage_list(profile: dict[str, Any], *keys: str) -> list[Any]:
    """Return the first populated usage list exposed by the ratings API."""
    empty_list: list[Any] = []
    for key in keys:
        value = profile.get(key)
        if isinstance(value, list):
            if value:
                return value
            empty_list = value
    return empty_list


MODULE_ICON_BY_PROPERTY = {
    "ALL_RESISTANCE": "all",
    "ARTILLERY_RESISTANCE": "magnum",
    "CRITICAL_RESISTANCE": "crit",
    "FIREBIRD_RESISTANCE": "firebird",
    "FREEZE_RESISTANCE": "freeze",
    "GAUSS_RESISTANCE": "gauss",
    "ISIS_RESISTANCE": "isida",
    "MACHINE_GUN_RESISTANCE": "vulcan",
    "MINE_RESISTANCE": "mine",
    "RAILGUN_RESISTANCE": "railgun",
    "RICOCHET_RESISTANCE": "ricochet",
    "ROCKET_LAUNCHER_RESISTANCE": "striker",
    "SCORPIO_RESISTANCE": "scorpion",
    "SHAFT_RESISTANCE": "shaft",
    "SHOTGUN_RESISTANCE": "hammer",
    "SMOKY_RESISTANCE": "smoky",
    "TESLA_RESISTANCE": "tesla",
    "THUNDER_RESISTANCE": "thunder",
    "TSUNAMI_RESISTANCE": "tsunami",
    "TWINS_RESISTANCE": "twins",
}


def aggregate_modules(items: Any) -> list[dict[str, Any]]:
    modules = aggregate_usage(items)
    icons: dict[str, str] = {}
    if isinstance(items, list):
        for raw in items:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "Unknown").strip() or "Unknown"
            properties = raw.get("properties") if isinstance(raw.get("properties"), list) else []
            icon = next(
                (
                    MODULE_ICON_BY_PROPERTY[str(value)]
                    for value in properties
                    if str(value) in MODULE_ICON_BY_PROPERTY
                ),
                None,
            )
            icons[name.casefold()] = icon or "all"
    for module in modules:
        module["icon"] = icons.get(module["name"].casefold(), "all")
    return modules


def strip_legacy_images(value: Any) -> None:
    """Remove equipment image fields left by earlier tracker versions in place."""
    if isinstance(value, dict):
        value.pop("image", None)
        for child in value.values():
            strip_legacy_images(child)
    elif isinstance(value, list):
        for child in value:
            strip_legacy_images(child)


def normalize_profile(profile: dict[str, Any], collected_at: str) -> dict[str, Any]:
    modes = aggregate_usage(profile.get("modesPlayed"))
    hulls = aggregate_usage(profile.get("hullsPlayed"))
    turrets = aggregate_usage(profile.get("turretsPlayed"))
    drones = aggregate_usage(profile.get("dronesPlayed"))
    modules = aggregate_modules(first_usage_list(
        profile,
        "modulesPlayed",
        "protectionModulesPlayed",
        "resistanceModulesPlayed",
        "resistancesPlayed",
        "resistanceModules",
        "modules",
    ))

    candidates = [
        sum(item["timeMs"] for item in modes),
        sum(item["timeMs"] for item in hulls),
        sum(item["timeMs"] for item in turrets),
    ]
    total_time = max(candidates)
    rating = profile.get("rating") if isinstance(profile.get("rating"), dict) else {}
    efficiency = rating.get("efficiency") if isinstance(rating.get("efficiency"), dict) else {}

    return {
        "at": collected_at,
        "name": str(profile.get("name") or "Unknown"),
        "rank": max(0, number_value(profile.get("rank"))),
        "score": max(0, number_value(profile.get("score"))),
        "scoreBase": max(0, number_value(profile.get("scoreBase"))),
        "scoreNext": max(0, number_value(profile.get("scoreNext"))),
        "kills": max(0, number_value(profile.get("kills"))),
        "deaths": max(0, number_value(profile.get("deaths"))),
        "crystals": max(0, number_value(profile.get("earnedCrystals"))),
        "golds": max(0, number_value(profile.get("caughtGolds"))),
        "efficiency": max(0, number_value(efficiency.get("value"))),
        "efficiencyPosition": number_value(efficiency.get("position"), -1),
        "totalTimeMs": total_time,
        "gearScore": max(0, number_value(profile.get("gearScore"))),
        "premium": bool(profile.get("hasPremium")),
        "equipment": {
            "hulls": hulls,
            "turrets": turrets,
            "drones": drones,
            "modules": modules,
            "modes": modes,
        },
    }


def compact_snapshot(current: dict[str, Any]) -> dict[str, Any]:
    return {
        "at": current["at"],
        "k": current["kills"],
        "d": current["deaths"],
        "c": current["crystals"],
        "s": current["score"],
        "g": current["golds"],
        "e": current["efficiency"],
        "r": current["rank"],
        "t": current["totalTimeMs"],
    }


def snapshot_changed(previous: dict[str, Any], current: dict[str, Any]) -> bool:
    return any(previous.get(key) != current.get(key) for key in ("k", "d", "c", "s", "g", "e", "r", "t"))


def merge_player(existing: Any, current: dict[str, Any], retention_days: int) -> dict[str, Any]:
    record = existing if isinstance(existing, dict) else {}
    history = record.get("history") if isinstance(record.get("history"), list) else []
    snapshot = compact_snapshot(current)
    previous = history[-1] if history else None
    previous_time = parse_time(previous.get("at")) if isinstance(previous, dict) else None
    current_time = parse_time(snapshot.get("at")) or utc_now()
    heartbeat_due = previous_time is None or current_time - previous_time >= timedelta(hours=23)
    rating_boundary_due = previous_time is not None and rating_day(previous_time) != rating_day(current_time)

    if previous is None or snapshot_changed(previous, snapshot) or heartbeat_due or rating_boundary_due:
        history.append(snapshot)

    cutoff = utc_now() - timedelta(days=retention_days)
    retained = [item for item in history if (parse_time(item.get("at")) or utc_now()) >= cutoff]
    if not retained and history:
        retained = [history[-1]]

    return {
        "current": current,
        "history": retained,
    }


def main() -> int:
    try:
        config = validate_config(load_json(CONFIG_PATH, {}))
    except ValueError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2

    tracker = load_json(
        TRACKER_PATH,
        {
            "schemaVersion": SCHEMA_VERSION,
            "generatedAt": None,
            "source": f"https://ratings.tankionline.com/api/{config['region']}/profile/",
            "players": {},
            "errors": {},
        },
    )
    if number_value(tracker.get("schemaVersion")) != SCHEMA_VERSION:
        print("Unsupported tracker schema. Restore a schema version 1 backup.", file=sys.stderr)
        return 2

    tracker_players = tracker.get("players") if isinstance(tracker.get("players"), dict) else {}
    errors = tracker.get("errors") if isinstance(tracker.get("errors"), dict) else {}
    collected_at = iso_time()
    successes = 0

    def collect(username: str) -> tuple[str, dict[str, Any]]:
        profile = fetch_profile(username, config["region"], config["language"])
        return username, normalize_profile(profile, collected_at)

    with ThreadPoolExecutor(max_workers=config["concurrency"]) as pool:
        futures = {pool.submit(collect, username): username for username in config["players"]}
        for future in as_completed(futures):
            requested_name = futures[future]
            requested_key = requested_name.casefold()
            try:
                _, current = future.result()
                canonical_key = current["name"].casefold()
                existing = tracker_players.get(canonical_key) or tracker_players.get(requested_key)
                tracker_players[canonical_key] = merge_player(existing, current, config["retentionDays"])
                if requested_key != canonical_key:
                    tracker_players.pop(requested_key, None)
                errors.pop(requested_key, None)
                errors.pop(canonical_key, None)
                successes += 1
                print(f"Tracked {current['name']}")
            except Exception as error:  # each player failure must not wipe other history
                errors[requested_key] = {"at": collected_at, "message": str(error)[:240]}
                print(f"Failed {requested_name}: {error}", file=sys.stderr)

    configured_keys = {name.casefold() for name in config["players"]}
    # Preserve removed accounts in history so accidental config edits are recoverable.
    tracker["schemaVersion"] = SCHEMA_VERSION
    tracker["source"] = f"https://ratings.tankionline.com/api/{config['region']}/profile/"
    tracker["players"] = dict(sorted(tracker_players.items(), key=lambda entry: entry[0]))
    tracker["errors"] = errors
    tracker["configuredPlayers"] = sorted(configured_keys)
    tracker["lastAttemptAt"] = collected_at
    if successes:
        tracker["generatedAt"] = collected_at

    strip_legacy_images(tracker)
    write_json_atomic(TRACKER_PATH, tracker)
    print(f"Completed: {successes}/{len(config['players'])} profiles updated.")
    return 0 if successes or not config["players"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
