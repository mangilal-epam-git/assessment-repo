from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List

import httpx


class ProviderClient:
    def __init__(self, provider_id: str, base_url: str, timeout_seconds: float = 5.0, retries: int = 3) -> None:
        self.provider_id = provider_id
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.retries = max(1, retries)

    async def fetch_offers(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/provider/{self.provider_id}"
        for attempt in range(1, self.retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    payload = response.json()
                    if not isinstance(payload, list):
                        raise ValueError("provider did not return a top-level array")
                    return payload
            except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError):
                if attempt == self.retries:
                    raise
                await asyncio.sleep(0.25 * attempt)
        raise RuntimeError(f"provider {self.provider_id} failed to return a valid payload")
