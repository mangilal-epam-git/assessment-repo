from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict


DEFAULT_CONFIG = {
    "fxVersion": "fx-demo-1",
    "fxRates": {
        "EUR": "1.00",
        "USD": "0.92",
        "GBP": "1.18",
    },
    "marginVersion": "margin-demo-1",
    "defaultMarginBasisPoints": 1000,
    "minimumQualityRatio": "0.90",
}


@dataclass(frozen=True)
class ConfigSnapshot:
    fx_version: str
    fx_rates: Dict[str, Decimal]
    margin_version: str
    default_margin_basis_points: int
    minimum_quality_ratio: Decimal


class RuntimeConfigStore:
    def __init__(self, config_path: Path | str) -> None:
        self.config_path = Path(config_path)
        self._snapshot: ConfigSnapshot | None = None
        self._ensure_config_file()
        self.reload()

    def _ensure_config_file(self) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.config_path.exists():
            self.config_path.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")

    def _validate_snapshot(self, raw: Dict[str, Any]) -> ConfigSnapshot:
        if not isinstance(raw, dict):
            raise ValueError("configuration root must be an object")

        fx_rates_raw = raw.get("fxRates")
        if not isinstance(fx_rates_raw, dict):
            raise ValueError("fxRates must be an object")

        fx_rates: Dict[str, Decimal] = {}
        for currency, value in fx_rates_raw.items():
            if not isinstance(currency, str) or not currency.strip():
                raise ValueError("currency code must be a non-empty string")
            if not isinstance(value, (str, int, float)):
                raise ValueError(f"FX value for {currency} is invalid")
            fx_rates[currency.upper()] = Decimal(str(value))

        default_margin = raw.get("defaultMarginBasisPoints")
        if not isinstance(default_margin, int) or default_margin < 0:
            raise ValueError("defaultMarginBasisPoints must be a non-negative integer")

        minimum_quality = raw.get("minimumQualityRatio")
        if not isinstance(minimum_quality, (str, int, float)):
            raise ValueError("minimumQualityRatio must be numeric")

        fx_version = raw.get("fxVersion")
        margin_version = raw.get("marginVersion")
        if not isinstance(fx_version, str) or not fx_version.strip():
            raise ValueError("fxVersion must be a non-empty string")
        if not isinstance(margin_version, str) or not margin_version.strip():
            raise ValueError("marginVersion must be a non-empty string")

        return ConfigSnapshot(
            fx_version=fx_version,
            fx_rates=fx_rates,
            margin_version=margin_version,
            default_margin_basis_points=default_margin,
            minimum_quality_ratio=Decimal(str(minimum_quality)),
        )

    def reload(self) -> ConfigSnapshot:
        try:
            with self.config_path.open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            snapshot = self._validate_snapshot(raw)
            self._snapshot = snapshot
            return snapshot
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            if self._snapshot is not None:
                return self._snapshot
            raise

    def get_snapshot(self) -> ConfigSnapshot:
        if self._snapshot is None:
            raise RuntimeError("No valid configuration snapshot has been loaded")
        return deepcopy(self._snapshot)

    def replace_snapshot(self, new_snapshot: ConfigSnapshot) -> ConfigSnapshot:
        self._snapshot = new_snapshot
        payload = {
            "fxVersion": new_snapshot.fx_version,
            "fxRates": {k: str(v) for k, v in new_snapshot.fx_rates.items()},
            "marginVersion": new_snapshot.margin_version,
            "defaultMarginBasisPoints": new_snapshot.default_margin_basis_points,
            "minimumQualityRatio": str(new_snapshot.minimum_quality_ratio),
        }
        self.config_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return deepcopy(new_snapshot)
