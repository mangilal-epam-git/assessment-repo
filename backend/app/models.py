from __future__ import annotations

from pydantic import BaseModel, Field


class OfferRow(BaseModel):
    productId: str
    eventCount: int
    validEventCount: int
    priceMinor: int
    currency: str
    observedAt: str
    expiresAt: str | None = None

    model_config = {"extra": "forbid"}


class AccessRequest(BaseModel):
    userId: str = Field(..., min_length=1)
    team: str = Field(..., min_length=1)
    dataDomains: list[str] = Field(default_factory=list)
    blockedPaymentTypes: list[str] = Field(default_factory=list)


class PaymentBlockRequest(BaseModel):
    paymentType: str = Field(..., min_length=1)


class BestOffersResponse(BaseModel):
    asOf: str
    currency: str
    fxVersion: str
    marginVersion: str
    partial: bool
    unavailableProviders: list[str]
    rejectedRows: list[dict]
    offers: list[dict]
