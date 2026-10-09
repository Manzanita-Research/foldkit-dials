"""Require existing state-store availability before CI may invoke Alchemy."""

import importlib.util
import pathlib
import re
import sys

SPEC = importlib.util.spec_from_file_location(
    "cloudflare_probe", pathlib.Path(__file__).with_name("cloudflare_probe.py")
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def unavailable(error):
    probe.emit({"preflight_ready": False, "error": error})
    return 1


def check(account, token, opener):
    if not probe.validate_credentials(account, token):
        return 1
    try:
        subdomain = probe.query(
            opener, "workers.getSubdomain",
            f"{probe.API_BASE}/accounts/{account}/workers/subdomain", token,
        )
        if subdomain.get("success") is not True:
            return unavailable("workers_metadata_unavailable")
        result = subdomain.get("result")
        label = result.get("subdomain") if isinstance(result, dict) else None
        if not isinstance(label, str) or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label
        ):
            return unavailable("workers_subdomain_unavailable")
        settings = probe.query(
            opener, "workers.getScriptSetting",
            f"{probe.API_BASE}/accounts/{account}/workers/scripts/alchemy-state-store/settings", token,
        )
        if settings.get("success") is not True or not isinstance(settings.get("result"), dict):
            return unavailable("state_worker_unavailable")
        stores = probe.query(
            opener, "secretsStore.listStores",
            f"{probe.API_BASE}/accounts/{account}/secrets_store/stores", token,
        )
        entries = stores.get("result")
        store_exists = isinstance(entries, list) and any(
            isinstance(entry, dict) and isinstance(entry.get("id"), str) and bool(entry["id"])
            for entry in entries
        )
        if stores.get("success") is not True or not store_exists:
            return unavailable("state_secrets_store_unavailable")
        version = probe.query(
            opener, "stateStore.version",
            f"https://alchemy-state-store.{label}.workers.dev/version",
        )
        if type(version.get("version")) is not int or version["version"] != probe.EXPECTED_CONTRACT:
            return unavailable("state_contract_unavailable")
    except probe.RateLimited:
        return 2
    probe.emit({"preflight_ready": True})
    return 0


if __name__ == "__main__":
    sys.exit(probe.main(check))
