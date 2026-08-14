#!/usr/bin/env python3
"""Collect compact Tanki Ratings snapshots for a static GitHub Pages site."""

from __future__ import annotations

import json
import os
import re
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
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")


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
        if not USERNAME_PATTERN.fullmatch(name):
            raise ValueError(
                f"Invalid player name {name!r}; use 3–64 letters, numbers, dots, underscores, or hyphens."
            )
        seen.add(key)
        names.append(name)

    if len(names) > 100:
        raise ValueError("This static tracker intentionally supports at most 100 configured players.")

    configured_names = {name.casefold(): name for name in names}
    raw_changes = config.get("usernameChanges", {})
    if not isinstance(raw_changes, dict):
        raise ValueError("usernameChanges must be an object keyed by the original tracked username.")

    changes: dict[str, dict[str, Any]] = {}
    for raw_stable_name, raw_change in raw_changes.items():
        stable_key = str(raw_stable_name).strip().casefold()
        stable_name = configured_names.get(stable_key)
        if not stable_name:
            raise ValueError(f"Username history references untracked player {raw_stable_name!r}.")
        if not isinstance(raw_change, dict):
            raise ValueError(f"Username history for {stable_name} must be an object.")
        changes[stable_key] = raw_change

    normalized_changes: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    alias_owners: dict[str, str] = {}
    for stable_name in names:
        stable_key = stable_name.casefold()
        change = changes.get(stable_key, {})
        current_name = str(change.get("current") or stable_name).strip()
        if not USERNAME_PATTERN.fullmatch(current_name):
            raise ValueError(f"Invalid current username for {stable_name}: {current_name!r}.")

        raw_previous = change.get("previous", [])
        if not isinstance(raw_previous, list):
            raise ValueError(f"Previous usernames for {stable_name} must be an array.")
        previous_names: list[str] = []
        previous_seen: set[str] = set()
        for raw_previous_name in raw_previous:
            previous_name = str(raw_previous_name).strip()
            previous_key = previous_name.casefold()
            if not USERNAME_PATTERN.fullmatch(previous_name):
                raise ValueError(f"Invalid previous username for {stable_name}: {previous_name!r}.")
            if previous_key == current_name.casefold() or previous_key in previous_seen:
                continue
            previous_seen.add(previous_key)
            previous_names.append(previous_name)
        if stable_key != current_name.casefold() and stable_key not in previous_seen:
            previous_names.insert(0, stable_name)

        record = {
            "id": stable_key,
            "stableName": stable_name,
            "currentName": current_name,
            "previousNames": previous_names,
        }
        for alias in player_aliases(record):
            alias_key = alias.casefold()
            owner = alias_owners.get(alias_key)
            if owner and owner != stable_key:
                raise ValueError(f"Username {alias!r} belongs to more than one tracked player.")
            alias_owners[alias_key] = stable_key
        records.append(record)
        if current_name.casefold() != stable_key or previous_names:
            normalized_changes[stable_name] = {
                "current": current_name,
                "previous": previous_names,
            }

    return {
        "players": names,
        "playerRecords": records,
        "usernameChanges": normalized_changes,
        "region": str(config.get("region", "eu")).strip().lower() or "eu",
        "language": str(config.get("language", "en")).strip().lower() or "en",
        "concurrency": max(1, min(6, number_value(config.get("concurrency"), 4))),
        "retentionDays": max(30, min(3650, number_value(config.get("retentionDays"), 730))),
    }


def player_aliases(record: dict[str, Any]) -> list[str]:
    aliases: list[str] = []
    seen: set[str] = set()
    for value in [record.get("stableName"), record.get("currentName"), *(record.get("previousNames") or [])]:
        name = str(value or "").strip()
        key = name.casefold()
        if name and key not in seen:
            seen.add(key)
            aliases.append(name)
    return aliases


def resolve_player_record(config: dict[str, Any], username: str) -> dict[str, Any] | None:
    requested_key = username.strip().casefold()
    for record in config.get("playerRecords", []):
        if any(alias.casefold() == requested_key for alias in player_aliases(record)):
            return record
    return None


def config_payload(config: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "players": config["players"],
        "region": config["region"],
        "language": config["language"],
        "concurrency": config["concurrency"],
        "retentionDays": config["retentionDays"],
    }
    if config.get("usernameChanges"):
        payload["usernameChanges"] = config["usernameChanges"]
    return payload


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


def combine_existing_player_records(
    tracker_players: dict[str, Any], record: dict[str, Any]
) -> dict[str, Any] | None:
    records: list[dict[str, Any]] = []
    seen_record_ids: set[int] = set()
    for alias in player_aliases(record):
        candidate = tracker_players.get(alias.casefold())
        if isinstance(candidate, dict) and id(candidate) not in seen_record_ids:
            seen_record_ids.add(id(candidate))
            records.append(candidate)
    if not records:
        return None

    stable_record = tracker_players.get(record["id"])
    current_record = stable_record if isinstance(stable_record, dict) else records[0]
    current = current_record.get("current") if isinstance(current_record.get("current"), dict) else None
    history_by_snapshot: dict[str, dict[str, Any]] = {}
    for candidate in records:
        if not current and isinstance(candidate.get("current"), dict):
            current = candidate["current"]
        history = candidate.get("history") if isinstance(candidate.get("history"), list) else []
        for snapshot in history:
            if not isinstance(snapshot, dict):
                continue
            key = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            history_by_snapshot[key] = snapshot
    history = sorted(
        history_by_snapshot.values(),
        key=lambda snapshot: str(snapshot.get("at") or ""),
    )
    return {"current": current or {}, "history": history}


def store_tracked_player(
    tracker_players: dict[str, Any],
    record: dict[str, Any],
    current: dict[str, Any],
    retention_days: int,
) -> dict[str, Any]:
    existing = combine_existing_player_records(tracker_players, record)
    merged = merge_player(existing, current, retention_days)
    merged["previousNames"] = list(record.get("previousNames") or [])
    stable_key = record["id"]
    tracker_players[stable_key] = merged
    for alias in player_aliases(record):
        alias_key = alias.casefold()
        if alias_key != stable_key:
            tracker_players.pop(alias_key, None)
    return merged


def clear_player_errors(errors: dict[str, Any], record: dict[str, Any]) -> None:
    for alias in player_aliases(record):
        errors.pop(alias.casefold(), None)


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

    def collect(record: dict[str, Any]) -> dict[str, Any]:
        profile = fetch_profile(record["currentName"], config["region"], config["language"])
        return normalize_profile(profile, collected_at)

    with ThreadPoolExecutor(max_workers=config["concurrency"]) as pool:
        futures = {pool.submit(collect, record): record for record in config["playerRecords"]}
        for future in as_completed(futures):
            record = futures[future]
            stable_key = record["id"]
            try:
                current = future.result()
                store_tracked_player(tracker_players, record, current, config["retentionDays"])
                clear_player_errors(errors, record)
                successes += 1
                print(f"Tracked {current['name']}")
            except Exception as error:  # each player failure must not wipe other history
                errors[stable_key] = {"at": collected_at, "message": str(error)[:240]}
                print(f"Failed {record['currentName']}: {error}", file=sys.stderr)

    configured_keys = {record["id"] for record in config["playerRecords"]}
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
