"""Stable fingerprint of the digest JSON sent to Claude (blueprint §8c)."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_digest_json(digest: dict[str, Any]) -> str:
    """Deterministic JSON serialization for hashing."""
    return json.dumps(digest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_digest_hash(digest: dict[str, Any]) -> str:
    """SHA-256 hex digest of the full digest object."""
    payload = canonical_digest_json(digest).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
