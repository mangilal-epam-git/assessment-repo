from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set


@dataclass
class UserAccess:
    user_id: str
    team: str
    data_domains: Set[str] = field(default_factory=set)
    blocked_payment_types: Set[str] = field(default_factory=set)


class AccessPolicyManager:
    def __init__(self) -> None:
        self._users: Dict[str, UserAccess] = {}

    def add_user(
        self,
        user_id: str,
        team: str,
        data_domains: Optional[Iterable[str]] = None,
        blocked_payment_types: Optional[Iterable[str]] = None,
    ) -> UserAccess:
        if not user_id or not team:
            raise ValueError("user_id and team must be non-empty")
        access = UserAccess(
            user_id=user_id,
            team=team,
            data_domains=set(data_domains or []),
            blocked_payment_types=set(blocked_payment_types or []),
        )
        self._users[user_id] = access
        return access

    def block_payment_type(self, user_id: str, payment_type: str) -> UserAccess:
        user = self._users.get(user_id)
        if user is None:
            raise KeyError(f"unknown user: {user_id}")
        if not payment_type:
            raise ValueError("payment_type must be non-empty")
        user.blocked_payment_types.add(payment_type)
        return user

    def unblock_payment_type(self, user_id: str, payment_type: str) -> UserAccess:
        user = self._users.get(user_id)
        if user is None:
            raise KeyError(f"unknown user: {user_id}")
        user.blocked_payment_types.discard(payment_type)
        return user

    def can_access(self, user_id: str, team: str, data_domain: str, payment_type: Optional[str] = None) -> bool:
        user = self._users.get(user_id)
        if user is None:
            return False
        if user.team != team:
            return False
        if data_domain not in user.data_domains:
            return False
        if payment_type and payment_type in user.blocked_payment_types:
            return False
        return True

    def list_users(self) -> List[dict]:
        return [
            {
                "userId": user.user_id,
                "team": user.team,
                "dataDomains": sorted(user.data_domains),
                "blockedPaymentTypes": sorted(user.blocked_payment_types),
            }
            for user in sorted(self._users.values(), key=lambda item: item.user_id)
        ]
