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
    fetch_profile,
    iso_time,
    load_json,
    merge_player,
    normalize_profile,
    number_value,
    strip_legacy_images,
    validate_config,
    write_json_atomic,
)


MESSAGE_PATH = Path(__file__).resolve().parents[1] / "request-message.txt"
TITLE_PATTERN = re.compile(r"^\[(Track|Refresh) player\]\s+(.+?)\s*$", re.IGNORECASE)
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")


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

    configured_key_map = {name.casefold(): name for name in config["players"]}
    requested_key = requested_name.casefold()
    if action == "refresh" and requested_key not in configured_key_map:
        return finish(
            f"Refresh rejected: **{requested_name}** is not tracked. Search for the account and submit a Track request first.",
            2,
        )

    try:
        profile = fetch_profile(requested_name, config["region"], config["language"])
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
    canonical_key = canonical_name.casefold()
    if action == "track" and canonical_key not in configured_key_map:
        if len(config["players"]) >= 100:
            return finish("Request rejected: this tracker already has its 100-player limit.", 1)
        config["players"].append(canonical_name)

    collected_at = iso_time()
    tracker = load_json(TRACKER_PATH, tracker_template(config["region"]))
    if number_value(tracker.get("schemaVersion")) != SCHEMA_VERSION:
        return finish("Request rejected: tracker.json is not schema version 1.", 2)

    tracker_players = tracker.get("players") if isinstance(tracker.get("players"), dict) else {}
    current = normalize_profile(profile, collected_at)
    existing = tracker_players.get(canonical_key) or tracker_players.get(requested_key)
    tracker_players[canonical_key] = merge_player(existing, current, config["retentionDays"])
    if requested_key != canonical_key:
        tracker_players.pop(requested_key, None)

    errors = tracker.get("errors") if isinstance(tracker.get("errors"), dict) else {}
    errors.pop(requested_key, None)
    errors.pop(canonical_key, None)
    tracker["schemaVersion"] = SCHEMA_VERSION
    tracker["generatedAt"] = collected_at
    tracker["lastAttemptAt"] = collected_at
    tracker["source"] = f"https://ratings.tankionline.com/api/{config['region']}/profile/"
    tracker["players"] = dict(sorted(tracker_players.items(), key=lambda entry: entry[0]))
    tracker["errors"] = errors
    tracker["configuredPlayers"] = sorted(name.casefold() for name in config["players"])
    strip_legacy_images(tracker)

    write_json_atomic(TRACKER_PATH, tracker)
    if action == "track":
        write_json_atomic(
            CONFIG_PATH,
            {
                "players": config["players"],
                "region": config["region"],
                "language": config["language"],
                "concurrency": config["concurrency"],
                "retentionDays": config["retentionDays"],
            },
        )
        return finish(f"**{canonical_name}** was verified, added, and collected successfully. The updated site will deploy shortly.", 0)

    return finish(f"A fresh snapshot for **{canonical_name}** was collected successfully. The updated site will deploy shortly.", 0)


if __name__ == "__main__":
    raise SystemExit(main())
