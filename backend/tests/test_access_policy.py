from __future__ import annotations

import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Tuple

from app.config import ConfigSnapshot
from app.validation import DECIMAL_2, DECIMAL_4, DECIMAL_6, format_decimal, parse_utc_datetime

ALLOWED_FIELDS = {
    "productId",
    "eventCount",
    "validEventCount",
    "priceMinor",
    "currency",
    "observedAt",
    "expiresAt",
}


def build_rejected_row(provider_id: str, row_index: int, reason: str) -> dict:
    return {"providerId": provider_id, "rowIndex": row_index, "reason": reason}


def validate_offer_row(
    provider_id: str,
    raw_row: Any,
    row_index: int,
    snapshot: ConfigSnapshot,
    now: datetime,
) -> Tuple[dict | None, dict | None]:
    if not isinstance(raw_row, dict):
        return None, build_rejected_row(provider_id, row_index, "INVALID_ROW")

    unknown_fields = sorted(set(raw_row.keys()) - ALLOWED_FIELDS)
    if unknown_fields:
        return None, build_rejected_row(provider_id, row_index, "UNKNOWN_FIELD")

    product_id = raw_row.get("productId")
    if not isinstance(product_id, str) or not product_id.strip():
        return None, build_rejected_row(provider_id, row_index, "INVALID_PRODUCT_ID")

    event_count = raw_row.get("eventCount")
    if isinstance(event_count, bool) or not isinstance(event_count, int) or event_count <= 0:
        return None, build_rejected_row(provider_id, row_index, "INVALID_EVENT_COUNT")

    valid_event_count = raw_row.get("validEventCount")
    if isinstance(valid_event_count, bool) or not isinstance(valid_event_count, int) or valid_event_count <= 0:
        return None, build_rejected_row(provider_id, row_index, "INVALID_VALID_EVENT_COUNT")
    if valid_event_count > event_count:
        return None, build_rejected_row(provider_id, row_index, "VALID_COUNT_EXCEEDS_EVENT_COUNT")

    price_minor = raw_row.get("priceMinor")
    if isinstance(price_minor, bool) or not isinstance(price_minor, int) or price_minor < 0:
        return None, build_rejected_row(provider_id, row_index, "INVALID_PRICE")

    currency = raw_row.get("currency")
    if not isinstance(currency, str) or not currency.strip() or currency.upper() not in snapshot.fx_rates:
        return None, build_rejected_row(provider_id, row_index, "UNSUPPORTED_CURRENCY")

    observed_at = parse_utc_datetime(raw_row.get("observedAt"))
    if observed_at is None:
        return None, build_rejected_row(provider_id, row_index, "INVALID_OBSERVED_AT")
    if observed_at > now:
        return None, build_rejected_row(provider_id, row_index, "FUTURE_OBSERVED_AT")

    expires_at_value = raw_row.get("expiresAt")
    if expires_at_value is None:
        expires_at = observed_at + timedelta(minutes=15)
    else:
        expires_at = parse_utc_datetime(expires_at_value)
        if expires_at is None or expires_at <= observed_at:
            return None, build_rejected_row(provider_id, row_index, "INVALID_EXPIRY")

    if now >= expires_at:
        return None, build_rejected_row(provider_id, row_index, "EXPIRED_OFFER")
    if now > observed_at + timedelta(minutes=15):
        return None, build_rejected_row(provider_id, row_index, "STALE_OFFER")

    quality_ratio = Decimal(valid_event_count) / Decimal(event_count)
    if quality_ratio < snapshot.minimum_quality_ratio:
        return None, build_rejected_row(provider_id, row_index, "LOW_QUALITY")

    provider_eur = (Decimal(price_minor) / Decimal(100)) * snapshot.fx_rates[currency.upper()]
    customer_bundle_eur = provider_eur * (Decimal(1) + (Decimal(snapshot.default_margin_basis_points) / Decimal(10000)))
    cost_per_1000_valid = (customer_bundle_eur * Decimal(1000)) / Decimal(valid_event_count)

    return {
        "productId": product_id,
        "providerId": provider_id,
        "eventCount": event_count,
        "validEventCount": valid_event_count,
        "qualityRatio": quality_ratio,
        "customerBundleEUR": customer_bundle_eur,
        "costPer1000ValidEventsEUR": cost_per_1000_valid,
        "observedAt": observed_at,
        "expiresAt": expires_at,
    }, None


def choose_best_offer(item_list: Iterable[dict]) -> dict:
    def sort_key(record: dict):
        return (
            record["costPer1000ValidEventsEUR"],
            -record["qualityRatio"],
            -record["observedAt"].timestamp(),
            record["providerId"],
        )

    return min(item_list, key=sort_key)


def build_best_offer_response(provider_payloads: Dict[str, List[dict]], snapshot: ConfigSnapshot, now: datetime) -> dict:
    all_rejections: List[dict] = []
    eligible_by_product: Dict[str, List[dict]] = {}

    for provider_id, rows in provider_payloads.items():
        seen_products = set()
        for row_index, raw_row in enumerate(rows):
            if not isinstance(raw_row, dict):
                all_rejections.append(build_rejected_row(provider_id, row_index, "INVALID_ROW"))
                continue

            product_id = raw_row.get("productId")
            if product_id in seen_products:
                all_rejections.append(build_rejected_row(provider_id, row_index, "DUPLICATE_PRODUCT_ID"))
                continue
            if product_id is not None:
                seen_products.add(product_id)

            validated_row, rejected = validate_offer_row(provider_id, raw_row, row_index, snapshot, now)
            if rejected is not None:
                all_rejections.append(rejected)
                continue
            if validated_row is not None:
                eligible_by_product.setdefault(validated_row["productId"], []).append(validated_row)

    offers: List[dict] = []
    for product_id in sorted(eligible_by_product.keys()):
        winner = choose_best_offer(eligible_by_product[product_id])
        offers.append(
            {
                "productId": product_id,
                "providerId": winner["providerId"],
                "eventCount": winner["eventCount"],
                "validEventCount": winner["validEventCount"],
                "qualityRatio": format_decimal(winner["qualityRatio"], DECIMAL_4),
                "customerBundleEUR": format_decimal(winner["customerBundleEUR"], DECIMAL_2),
                "costPer1000ValidEventsEUR": format_decimal(winner["costPer1000ValidEventsEUR"], DECIMAL_6),
                "observedAt": winner["observedAt"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                "expiresAt": winner["expiresAt"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )

    return {
        "asOf": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "currency": "EUR",
        "fxVersion": snapshot.fx_version,
        "marginVersion": snapshot.margin_version,
        "partial": bool(all_rejections),
        "unavailableProviders": [],
        "rejectedRows": all_rejections,
        "offers": offers,
    }


def serialise_result_for_api(payload: dict) -> dict:
    return json.loads(json.dumps(payload))
