from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


DECIMAL_2 = Decimal("0.01")
DECIMAL_4 = Decimal("0.0001")
DECIMAL_6 = Decimal("0.000001")


def parse_utc_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def decimal_from_str(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def quantize_decimal(value: Decimal, precision: Decimal) -> Decimal:
    return value.quantize(precision, rounding=ROUND_HALF_UP)


def parse_rfc3339_z(value: Any) -> str:
    dt = parse_utc_datetime(value)
    if dt is None:
        raise ValueError("invalid RFC3339 timestamp")
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_effective_expiry(observed_at: datetime, expires_at: str | None) -> datetime:
    if expires_at is None:
        return observed_at + timedelta(minutes=15)
    expiry = parse_utc_datetime(expires_at)
    if expiry is None:
        raise ValueError("invalid expiresAt")
    if expiry <= observed_at:
        raise ValueError("expiresAt must be later than observedAt")
    return expiry


def format_decimal(value: Decimal, precision: Decimal) -> str:
    return format(quantize_decimal(value, precision), "f")
