#!/usr/bin/env python3
"""Owner-only migration for a tracked player's renamed Tanki account."""

from __future__ import annotations

import os
import sys
from typing import Any

from track import (
    CONFIG_PATH,
    SCHEMA_VERSION,
    TRACKER_PATH,
    USERNAME_PATTERN,
    clear_player_errors,
    config_payload,
    fetch_profile,
    iso_time,
    load_json,
    normalize_profile,
    number_value,
    resolve_player_record,
    store_tracked_player,
    strip_legacy_images,
    validate_config,
    write_json_atomic,
)


def tracker_template(region: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": None,
        "source": f"https://ratings.tankionline.com/api/{region}/profile/",
        "players": {},
        "errors": {},
    }


def unique_names(names: list[str], excluded: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = {excluded.casefold()}
    for name in names:
        clean_name = str(name).strip()
        key = clean_name.casefold()
        if clean_name and key not in seen:
            seen.add(key)
            values.append(clean_name)
    return values


def main() -> int:
    tracked_name = os.environ.get("TRACKED_PLAYER", "").strip()
    requested_new_name = os.environ.get("NEW_USERNAME", "").strip()
    if not USERNAME_PATTERN.fullmatch(tracked_name) or not USERNAME_PATTERN.fullmatch(requested_new_name):
        print(
            "Both usernames must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.",
            file=sys.stderr,
        )
        return 2

    try:
        config = validate_config(load_json(CONFIG_PATH, {}))
    except ValueError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2

    old_record = resolve_player_record(config, tracked_name)
    if not old_record:
        print(f"{tracked_name} is not a tracked player or known previous username.", file=sys.stderr)
        return 2

    try:
        profile = fetch_profile(requested_new_name, config["region"], config["language"])
    except Exception as error:
        print(f"Could not verify {requested_new_name}: {error}", file=sys.stderr)
        return 1

    canonical_name = str(profile.get("name") or requested_new_name).strip()
    if not USERNAME_PATTERN.fullmatch(canonical_name):
        print("Tanki Ratings returned an invalid canonical username.", file=sys.stderr)
        return 1
    other_record = resolve_player_record(config, canonical_name)
    if other_record and other_record["id"] != old_record["id"]:
        print(f"{canonical_name} already belongs to another tracked player.", file=sys.stderr)
        return 2

    previous_names = unique_names(
        [*old_record.get("previousNames", []), old_record["stableName"], old_record["currentName"]],
        canonical_name,
    )
    payload = config_payload(config)
    username_changes = payload.setdefault("usernameChanges", {})
    username_changes[old_record["stableName"]] = {
        "current": canonical_name,
        "previous": previous_names,
    }
    try:
        config = validate_config(payload)
    except ValueError as error:
        print(f"Username migration is invalid: {error}", file=sys.stderr)
        return 2
    new_record = resolve_player_record(config, canonical_name)
    if not new_record:
        print("The updated player record could not be resolved.", file=sys.stderr)
        return 2

    collected_at = iso_time()
    tracker = load_json(TRACKER_PATH, tracker_template(config["region"]))
    if number_value(tracker.get("schemaVersion")) != SCHEMA_VERSION:
        print("tracker.json is not schema version 1.", file=sys.stderr)
        return 2
    tracker_players = tracker.get("players") if isinstance(tracker.get("players"), dict) else {}
    current = normalize_profile(profile, collected_at)
    store_tracked_player(tracker_players, new_record, current, config["retentionDays"])

    errors = tracker.get("errors") if isinstance(tracker.get("errors"), dict) else {}
    clear_player_errors(errors, old_record)
    clear_player_errors(errors, new_record)
    tracker["schemaVersion"] = SCHEMA_VERSION
    tracker["generatedAt"] = collected_at
    tracker["lastAttemptAt"] = collected_at
    tracker["source"] = f"https://ratings.tankionline.com/api/{config['region']}/profile/"
    tracker["players"] = dict(sorted(tracker_players.items(), key=lambda entry: entry[0]))
    tracker["errors"] = errors
    tracker["configuredPlayers"] = sorted(record["id"] for record in config["playerRecords"])
    strip_legacy_images(tracker)

    write_json_atomic(CONFIG_PATH, config_payload(config))
    write_json_atomic(TRACKER_PATH, tracker)
    print(
        f"Updated {old_record['stableName']} from {old_record['currentName']} to {canonical_name}; "
        f"preserved {len(new_record['previousNames'])} previous username(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
