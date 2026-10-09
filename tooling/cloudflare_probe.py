"""GET-only CI diagnosis. Emit allowlisted summaries, never response text."""

import json
import os
import re
import signal
import sys
import urllib.error
import urllib.request

API_BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_CONTRACT = 7  # alchemy@2.0.0-beta.80 StateStore/Api.ts
MAX_BODY_BYTES = 65536
REQUEST_TIMEOUT_SECONDS = 10
TOTAL_TIMEOUT_SECONDS = 90
RATE_LIMIT_MESSAGE = re.compile(
    r"\b(rate ?limit(ed|ing)?|throttl(ed|ing) your request)\b", re.IGNORECASE
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RateLimited(Exception):
    pass


class DeadlineExpired(BaseException):
    pass


def emit(summary):
    print(json.dumps(summary, sort_keys=True), flush=True)


def query(opener, operation, url, token=None):
    # Match the normal Node client. Python-urllib's default User-Agent can
    # receive an edge 403 from an otherwise healthy workers.dev endpoint.
    headers = {"User-Agent": "node"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        try:
            response = opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.code
            # Never serialize an untrusted status, header or exception object.
            status = status if type(status) is int and 100 <= status <= 599 else None
            if status == 429:
                emit({"operation": operation, "http_status": 429, "rate_limited": True})
                raise RateLimited()
            raw = response.read(MAX_BODY_BYTES + 1)
    except RateLimited:
        raise
    except Exception:
        emit({"operation": operation, "transport_error": True})
        return {}

    try:
        body = json.loads(raw) if len(raw) <= MAX_BODY_BYTES else None
    except (ValueError, UnicodeError, RecursionError):
        body = None
    is_object = isinstance(body, dict)
    body = body if is_object else {}
    errors = body.get("errors")
    errors = errors if isinstance(errors, list) else []
    codes = sorted({
        error["code"] for error in errors
        if isinstance(error, dict) and type(error.get("code")) is int
        and 0 <= error["code"] <= 999999
    })[:16]
    limited = any(
        isinstance(error, dict) and (
            error.get("code") == 971 or (
                isinstance(error.get("message"), str)
                and RATE_LIMIT_MESSAGE.search(error["message"]) is not None
            )
        )
        for error in errors
    )
    success = status is not None and 200 <= status < 300 and body.get("success") is True
    summary = {
        "operation": operation, "http_status": status, "success": success,
        "error_codes": codes, "response_object": is_object,
    }
    result = body.get("result")
    if operation.endswith("token.verify"):
        summary["active"] = success and isinstance(result, dict) and result.get("status") == "active"
    if operation == "stateStore.version":
        summary["matches_pinned_contract"] = (
            status == 200 and type(body.get("version")) is int
            and body["version"] == EXPECTED_CONTRACT
        )
    if limited:
        summary["rate_limited"] = True
    emit(summary)
    if limited:
        raise RateLimited()
    return body if success or (operation == "stateStore.version" and status == 200) else {}


def validate_credentials(account, token):
    account_format_valid = isinstance(account, str) and re.fullmatch(r"[0-9a-fA-F]{32}", account) is not None
    token_format_valid = isinstance(token, str) and re.fullmatch(r"[!-~]{1,4096}", token) is not None
    if not account_format_valid or not token_format_valid:
        emit({
            "account_present": isinstance(account, str) and bool(account),
            "account_format_valid": account_format_valid,
            "token_present": isinstance(token, str) and bool(token),
            "token_format_valid": token_format_valid,
            "token_has_surrounding_whitespace": isinstance(token, str) and token != token.strip(),
            "token_trimmed_format_valid": isinstance(token, str) and re.fullmatch(r"[!-~]{1,4096}", token.strip()) is not None,
        })
        emit({"error": "invalid_credentials"})
        return False
    return True


def diagnose(account, token, opener):
    if not validate_credentials(account, token):
        return 1
    try:
        verified = query(opener, "account.token.verify", f"{API_BASE}/accounts/{account}/tokens/verify", token)
        if verified.get("success") is not True:
            query(opener, "user.token.verify", f"{API_BASE}/user/tokens/verify", token)
        subdomain = query(opener, "workers.getSubdomain", f"{API_BASE}/accounts/{account}/workers/subdomain", token)
        query(opener, "workers.getScriptSetting", f"{API_BASE}/accounts/{account}/workers/scripts/alchemy-state-store/settings", token)
        query(opener, "secretsStore.listStores", f"{API_BASE}/accounts/{account}/secrets_store/stores", token)
        result = subdomain.get("result")
        label = result.get("subdomain") if isinstance(result, dict) else None
        if isinstance(label, str) and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label):
            # Public version endpoint receives no Authorization header.
            query(opener, "stateStore.version", f"https://alchemy-state-store.{label}.workers.dev/version")
        else:
            emit({"operation": "stateStore.version", "skipped_invalid_subdomain": True})
    except RateLimited:
        return 2
    return 0


def diagnose_trimmed_readonly(account, token, opener):
    # Explicit GET-only investigation. The original environment and raw
    # preflight path remain untouched; this local candidate is never saved.
    if not isinstance(token, str):
        return diagnose(account, token, opener)
    candidate = token.strip()
    emit({"read_only_trimmed_verification": True})
    return diagnose(account, candidate, opener)


def expire(signum, frame):
    raise DeadlineExpired()


def main(diagnoser=diagnose):
    previous_handler = signal.signal(signal.SIGALRM, expire)
    signal.alarm(TOTAL_TIMEOUT_SECONDS)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        return diagnoser(os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), opener)
    except DeadlineExpired:
        emit({"error": "deadline"})
        return 3
    except Exception:
        emit({"error": "internal_error"})
        return 1
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


if __name__ == "__main__":
    if sys.argv[1:] == ["--verify-trimmed-readonly"]:
        sys.exit(main(diagnose_trimmed_readonly))
    elif sys.argv[1:]:
        emit({"error": "invalid_mode"})
        sys.exit(1)
    else:
        sys.exit(main())
