#!/usr/bin/env python3
"""Validate a GitHub Issue request and collect one Tanki profile."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any

from track import (
    CONFIG_PATH,
    SCHEMA_VERSION,
    TRACKER_PATH,
    ProfileNotFoundError,
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


MESSAGE_PATH = Path(__file__).resolve().parents[1] / "request-message.txt"
TITLE_PATTERN = re.compile(r"^\[(Track|Refresh) player\]\s+(.+?)\s*$", re.IGNORECASE)


def finish(message: str, code: int) -> int:
    MESSAGE_PATH.write_text(message.rstrip() + "\n", encoding="utf-8")
    print(message, file=sys.stderr if code else sys.stdout)
    return code


def tracker_template(region: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": None,
        "source": f"https://ratings.tankionline.com/api/{region}/profile/",
        "players": {},
        "errors": {},
    }


def main() -> int:
    title = os.environ.get("REQUEST_TITLE", "").strip()
    match = TITLE_PATTERN.fullmatch(title)
    if not match:
        return finish("Request rejected: the issue title was not a supported player request.", 2)

    action = match.group(1).casefold()
    requested_name = match.group(2).strip()
    if not USERNAME_PATTERN.fullmatch(requested_name):
        return finish(
            "Request rejected: usernames must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.",
            2,
        )

    try:
        config = validate_config(load_json(CONFIG_PATH, {}))
    except ValueError as error:
        return finish(f"Tracker configuration error: {error}", 2)

    player_record = resolve_player_record(config, requested_name)
    if action == "refresh" and not player_record:
        return finish(
            f"Refresh rejected: **{requested_name}** is not tracked. Search for the account and submit a Track request first.",
            2,
        )

    lookup_name = player_record["currentName"] if player_record else requested_name
    try:
        profile = fetch_profile(lookup_name, config["region"], config["language"])
    except ProfileNotFoundError:
        return finish(
            f"Request rejected: Tanki Ratings returned `NOT_FOUND` for **{requested_name}**. The account is private or does not exist.",
            1,
        )
    except Exception as error:
        return finish(f"The Tanki Ratings request failed temporarily: {str(error)[:240]}", 1)

    canonical_name = str(profile.get("name") or requested_name).strip()
    if not USERNAME_PATTERN.fullmatch(canonical_name):
        return finish("Request rejected: Tanki Ratings returned an invalid canonical username.", 1)
    added_player = False
    if not player_record:
        if len(config["players"]) >= 100:
            return finish("Request rejected: this tracker already has its 100-player limit.", 1)
        config["players"].append(canonical_name)
        config = validate_config(config_payload(config))
        player_record = resolve_player_record(config, canonical_name)
        added_player = True
    if not player_record:
        return finish("Request rejected: the player could not be resolved after validation.", 2)

    collected_at = iso_time()
    tracker = load_json(TRACKER_PATH, tracker_template(config["region"]))
    if number_value(tracker.get("schemaVersion")) != SCHEMA_VERSION:
        return finish("Request rejected: tracker.json is not schema version 1.", 2)

    tracker_players = tracker.get("players") if isinstance(tracker.get("players"), dict) else {}
    current = normalize_profile(profile, collected_at)
    store_tracked_player(tracker_players, player_record, current, config["retentionDays"])

    errors = tracker.get("errors") if isinstance(tracker.get("errors"), dict) else {}
    clear_player_errors(errors, player_record)
    tracker["schemaVersion"] = SCHEMA_VERSION
    tracker["generatedAt"] = collected_at
    tracker["lastAttemptAt"] = collected_at
    tracker["source"] = f"https://ratings.tankionline.com/api/{config['region']}/profile/"
    tracker["players"] = dict(sorted(tracker_players.items(), key=lambda entry: entry[0]))
    tracker["errors"] = errors
    tracker["configuredPlayers"] = sorted(record["id"] for record in config["playerRecords"])
    strip_legacy_images(tracker)

    write_json_atomic(TRACKER_PATH, tracker)
    if added_player:
        write_json_atomic(CONFIG_PATH, config_payload(config))
        return finish(f"**{canonical_name}** was verified, added, and collected successfully. The updated site will deploy shortly.", 0)

    return finish(f"A fresh snapshot for **{canonical_name}** was collected successfully. The updated site will deploy shortly.", 0)


if __name__ == "__main__":
    raise SystemExit(main())
