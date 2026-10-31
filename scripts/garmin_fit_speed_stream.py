#!/usr/bin/env python3
"""Return true FIT record speed fields for one Garmin activity.

The desktop backend launches this as a local subprocess for activity-detail repair. It
reads Garmin auth only through Garmin's existing out-of-band token store and
prints only per-record timestamps plus true FIT record speed in meters per
second. It never prints token contents, token paths, raw FIT bytes,
coordinates, distance, altitude, heart rate, cadence, power, environment
values, or full connector payloads.
"""

from __future__ import annotations

import gzip
import io
import json
import math
import os
import sys
import zipfile
from garmin_token_location import tokenstore
from typing import Any

from fitparse import FitFile
from garminconnect import Garmin


def extract_fit_bytes(raw: bytes) -> bytes:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for name in archive.namelist():
                if name.lower().endswith(".fit"):
                    return archive.read(name)
            raise ValueError("ZIP archive contains no FIT file")
    return raw


def field(message: Any, name: str) -> Any:
    try:
        return message.get_value(name)
    except Exception:
        return None


def finite_non_negative_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed) or parsed < 0:
        return None
    return parsed


def speed_mps_from_record(message: Any) -> float | None:
    enhanced_speed = finite_non_negative_number(field(message, "enhanced_speed"))
    if enhanced_speed is not None:
        return enhanced_speed
    return finite_non_negative_number(field(message, "speed"))


def parse_speed_records(raw: bytes) -> dict[str, Any]:
    fit = FitFile(io.BytesIO(extract_fit_bytes(raw)))
    records: list[dict[str, Any]] = []
    record_count = 0
    for message in fit.get_messages("record"):
        record_count += 1
        speed_mps = speed_mps_from_record(message)
        if speed_mps is None:
            continue
        timestamp = field(message, "timestamp")
        records.append(
            {
                "timestamp": str(timestamp or ""),
                "speed_mps": speed_mps,
            }
        )
    return {
        "source": "garmin-fit-speed-stream",
        "record_count": record_count,
        "speed_record_count": len(records),
        "records": records,
    }


def main() -> int:
    activity_ids = [item for item in sys.argv[1:] if item.strip()]
    if not activity_ids:
        print(json.dumps({"records": []}, separators=(",", ":")))
        return 0

    activity_id = int(activity_ids[0])
    garmin = Garmin(is_cn=os.getenv("GARMIN_IS_CN", "").lower() in {"1", "true", "yes"})
    garmin.login(tokenstore())
    raw = garmin.download_activity(
        activity_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
    )
    parsed = parse_speed_records(bytes(raw))
    print(json.dumps(parsed, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
