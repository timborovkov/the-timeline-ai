"""Match a Bun executable against the repository `.bun-version` pin."""

from __future__ import annotations


def matches_bun_pin(pin: str, *, version: str, revision: str) -> bool:
    """Return whether a Bun binary satisfies the pin in `.bun-version`.

    Numeric / concrete pins (for example ``1.4.5``) require an exact match with
    ``process.versions.bun``. The channel selector ``canary`` accepts any canary
    build, detected via ``bun --revision`` containing ``canary``.
    """
    normalized = pin.strip()
    if not normalized:
        return False
    if normalized == "canary":
        return "canary" in revision.lower()
    return version == normalized
