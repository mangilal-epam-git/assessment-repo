from __future__ import annotations

from app.access_policy import AccessPolicyManager


def test_user_access_and_payment_blocking() -> None:
    manager = AccessPolicyManager()
    manager.add_user(
        user_id="u-1001",
        team="fleet-ops",
        data_domains={"telematics", "diagnostics"},
        blocked_payment_types={"bitcoin"},
    )

    assert manager.can_access("u-1001", "fleet-ops", "telematics") is True
    assert manager.can_access("u-1001", "fleet-ops", "telematics", "bitcoin") is False
    assert manager.can_access("u-1001", "fleet-ops", "diagnostics", "visa") is True

    manager.unblock_payment_type("u-1001", "bitcoin")
    assert manager.can_access("u-1001", "fleet-ops", "telematics", "bitcoin") is True

    records = manager.list_users()
    assert records[0]["userId"] == "u-1001"
    assert "telematics" in records[0]["dataDomains"]
