"""Offline security checks; all credentials and HTTP responses are synthetic."""

import contextlib
import email.message
import importlib.util
import io
import json
import pathlib
import time
import unittest
import urllib.request
import urllib.response
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "cloudflare_probe", pathlib.Path(__file__).with_name("cloudflare_probe.py")
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)
ACCOUNT = "a" * 32
TOKEN = "SYNTHETIC_TOKEN_NEVER_PRINT"
MARKER = "UNTRUSTED_BODY_ID_URL_HEADER"


class Response:
    def __init__(self, body, status=200, raw=None):
        self.code = status
        self.raw = json.dumps(body).encode() if raw is None else raw
        self.read_sizes = []
        self.close_callback = lambda: None

    def read(self, size):
        self.read_sizes.append(size)
        return self.raw[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close_callback()


class Opener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []
        self.active = False

    def open(self, request, timeout):
        if self.active:
            raise AssertionError("Requests must be serial and closed")
        self.requests.append((request, timeout))
        response = next(self.responses)
        if isinstance(response, BaseException):
            raise response
        self.active = True
        response.close_callback = lambda: setattr(self, "active", False)
        return response


def run(responses, account=ACCOUNT, token=TOKEN):
    opener = Opener(responses)
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = probe.diagnose(account, token, opener)
    return code, opener, stdout.getvalue(), stderr.getvalue()


def successful_responses():
    return [
        Response({"success": True, "result": {"status": "active", "id": MARKER}}),
        Response({"success": True, "result": {"subdomain": "synthetic"}}),
        Response({"success": True, "result": {"bindings": MARKER}}),
        Response({"success": True, "result": [{"id": MARKER}]}),
        Response({"version": 7, "arbitrary": TOKEN}),
    ]


class ProbeTests(unittest.TestCase):
    def assert_sanitized(self, output, stderr=""):
        for forbidden in (ACCOUNT, TOKEN, MARKER, "https://", "Authorization", "Traceback"):
            self.assertNotIn(forbidden, output + stderr)
        self.assertEqual(stderr, "")
        for line in output.splitlines():
            json.loads(line)

    def test_only_serial_gets_with_fixed_api_host_and_no_public_auth(self):
        responses = successful_responses()
        code, opener, output, stderr = run(responses)
        self.assertEqual(code, 0)
        self.assertEqual(len(opener.requests), 5)
        for request, timeout in opener.requests:
            self.assertEqual(request.get_method(), "GET")
            self.assertIsNone(request.data)
            self.assertEqual(timeout, 10)
        for request, _ in opener.requests[:-1]:
            self.assertEqual(request.host, "api.cloudflare.com")
            self.assertTrue(request.full_url.startswith(probe.API_BASE + "/"))
            self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
        public = opener.requests[-1][0]
        self.assertEqual(public.full_url, "https://alchemy-state-store.synthetic.workers.dev/version")
        self.assertIsNone(public.get_header("Authorization"))
        self.assertTrue(all(response.read_sizes == [65537] for response in responses))
        self.assertFalse(opener.active)
        self.assertTrue(json.loads(output.splitlines()[-1])["matches_pinned_contract"])
        self.assert_sanitized(output, stderr)

    def test_user_token_fallback_is_one_get_not_retry(self):
        responses = [Response({"success": False, "errors": [{"code": 10000, "message": TOKEN}]}, 403)]
        responses += successful_responses()
        code, opener, output, stderr = run(responses)
        self.assertEqual(code, 0)
        self.assertEqual(len(opener.requests), 6)
        self.assertEqual(opener.requests[1][0].full_url, probe.API_BASE + "/user/tokens/verify")
        self.assertEqual(len({request.full_url for request, _ in opener.requests}), 6)
        self.assert_sanitized(output, stderr)

    def test_invalid_credentials_make_no_requests_and_do_not_echo(self):
        for account, token in [(None, TOKEN), (MARKER, TOKEN), (ACCOUNT, None), (ACCOUNT, TOKEN + "\n")]:
            with self.subTest(account_is_valid=account == ACCOUNT):
                code, opener, output, stderr = run([], account, token)
                self.assertEqual(code, 1)
                self.assertEqual(opener.requests, [])
                self.assert_sanitized(output, stderr)

    def test_invalid_account_reports_only_presence_and_format_booleans(self):
        for account, present in [(None, False), ("", False), (7, False),
                                 (MARKER, True), (ACCOUNT + "\n", True),
                                 ("g" * 32, True), ("a" * 31, True)]:
            with self.subTest(present=present):
                code, opener, output, stderr = run([], account, TOKEN)
                self.assertEqual(code, 1)
                self.assertEqual(opener.requests, [])
                rows = [json.loads(line) for line in output.splitlines()]
                self.assertEqual(rows, [{
                    "account_present": present, "account_format_valid": False,
                    "token_present": True, "token_format_valid": True,
                }, {"error": "invalid_credentials"}])
                self.assertTrue(all(type(value) is bool for value in rows[0].values()))
                self.assert_sanitized(output, stderr)

    def test_invalid_token_reports_only_presence_and_format_booleans(self):
        for token, present in [(None, False), ("", False), (7, False),
                               (TOKEN + "\n", True), (TOKEN + " ", True),
                               (TOKEN + "\x00", True), (TOKEN + "é", True),
                               ("x" * 4097, True)]:
            with self.subTest(present=present):
                code, opener, output, stderr = run([], ACCOUNT, token)
                self.assertEqual(code, 1)
                self.assertEqual(opener.requests, [])
                rows = [json.loads(line) for line in output.splitlines()]
                self.assertEqual(rows, [{
                    "account_present": True, "account_format_valid": True,
                    "token_present": present, "token_format_valid": False,
                }, {"error": "invalid_credentials"}])
                self.assertTrue(all(type(value) is bool for value in rows[0].values()))
                self.assert_sanitized(output, stderr)

    def test_both_invalid_fields_report_only_four_literal_booleans(self):
        code, opener, output, stderr = run([], MARKER, TOKEN + "\n")
        self.assertEqual(code, 1)
        self.assertEqual(opener.requests, [])
        rows = [json.loads(line) for line in output.splitlines()]
        self.assertEqual(rows, [{
            "account_present": True, "account_format_valid": False,
            "token_present": True, "token_format_valid": False,
        }, {"error": "invalid_credentials"}])
        self.assertTrue(all(type(value) is bool for value in rows[0].values()))
        self.assert_sanitized(output, stderr)

    def test_rate_limit_stops_immediately_without_reading_429_body(self):
        response = Response(None, 429, raw=TOKEN.encode())
        code, opener, output, stderr = run([response])
        self.assertEqual(code, 2)
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(response.read_sizes, [])
        self.assert_sanitized(output, stderr)

    def test_envelope_rate_limit_stops_at_any_position(self):
        cases = [
            [{"code": 971}],
            [{"code": number} for number in range(30)] + [{"code": 971}],
            [{"code": 10000, "message": "Rate limited. " + TOKEN}],
        ]
        for errors in cases:
            with self.subTest(error_count=len(errors)):
                code, opener, output, stderr = run([Response({"errors": errors})])
                self.assertEqual(code, 2)
                self.assertEqual(len(opener.requests), 1)
                self.assert_sanitized(output, stderr)
        for index in range(5):
            responses = successful_responses()[:index] + [Response(None, 429)]
            code, opener, output, stderr = run(responses)
            self.assertEqual(code, 2)
            self.assertEqual(len(opener.requests), index + 1)

    def test_response_shapes_and_malformed_json_do_not_escape(self):
        bodies = [None, [], MARKER, 7, {"errors": MARKER}, {"errors": None},
                  {"errors": [None, MARKER, {"code": TOKEN}]},
                  {"success": True, "result": {"subdomain": {"id": MARKER}}}]
        for body in bodies:
            with self.subTest(body_type=type(body).__name__):
                code, opener, output, stderr = run([Response(body) for _ in range(5)])
                self.assertEqual(code, 0)
                self.assertLessEqual(len(opener.requests), 5)
                self.assert_sanitized(output, stderr)
        for raw in (TOKEN.encode(), b"[" * 2000, b"\xff", b"x" * 65537):
            opener = Opener([Response(None, raw=raw)])
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                probe.query(opener, "account.token.verify", probe.API_BASE + "/user/tokens/verify", TOKEN)
            self.assert_sanitized(output.getvalue())

    def test_subdomain_cannot_inject_host_path_or_output(self):
        for label in ("evil.example", "evil/path", "evil@attacker", "x" * 64, "-evil", TOKEN, None, []):
            responses = successful_responses()
            responses[1] = Response({"success": True, "result": {"subdomain": label}})
            code, opener, output, stderr = run(responses)
            self.assertEqual(code, 0)
            self.assertEqual(len(opener.requests), 4)
            self.assert_sanitized(output, stderr)

    def test_transport_errors_are_sanitized_and_not_retried(self):
        code, opener, output, stderr = run([RuntimeError(TOKEN + MARKER) for _ in range(5)])
        self.assertEqual(code, 0)
        self.assertEqual(len(opener.requests), 5)
        self.assertEqual(len({request.full_url for request, _ in opener.requests}), 5)
        self.assert_sanitized(output, stderr)

    def test_real_urllib_redirect_processor_never_follows_location(self):
        for status in (301, 302, 303, 307, 308):
            seen = []

            class FakeHTTPS(urllib.request.HTTPSHandler):
                def https_open(self, request):
                    seen.append(request)
                    headers = email.message.Message()
                    headers["Location"] = "https://attacker.invalid/" + TOKEN
                    response = urllib.response.addinfourl(io.BytesIO(TOKEN.encode()), headers, request.full_url, status)
                    response.msg = "Found"
                    return response

            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), probe.NoRedirect(), FakeHTTPS())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                probe.query(opener, "account.token.verify", probe.API_BASE + "/user/tokens/verify", TOKEN)
            self.assertEqual(len(seen), 1)
            self.assertEqual(seen[0].host, "api.cloudflare.com")
            self.assert_sanitized(output.getvalue())

    def test_deadline_is_sanitized_and_timer_restored(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(probe.signal, "signal", return_value="previous") as handler, \
                patch.object(probe.signal, "alarm") as alarm, \
                patch.object(probe.urllib.request, "build_opener", side_effect=probe.DeadlineExpired()), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(probe.main(), 3)
        self.assertEqual([call.args[0] for call in alarm.call_args_list], [90, 0])
        self.assertEqual(handler.call_args_list[-1].args, (probe.signal.SIGALRM, "previous"))
        self.assert_sanitized(stdout.getvalue(), stderr.getvalue())

    def test_main_never_prints_unexpected_exception_text(self):
        output = io.StringIO()
        with patch.object(probe.urllib.request, "build_opener", side_effect=RuntimeError(TOKEN)), \
                contextlib.redirect_stdout(output):
            self.assertEqual(probe.main(), 1)
        self.assert_sanitized(output.getvalue())

    def test_real_deadline_interrupts_a_stalled_request(self):
        opener = Opener([])
        output = io.StringIO()
        started = time.monotonic()
        with patch.dict(probe.os.environ, {"CLOUDFLARE_ACCOUNT_ID": ACCOUNT, "CLOUDFLARE_API_TOKEN": TOKEN}, clear=True), \
                patch.object(probe, "TOTAL_TIMEOUT_SECONDS", 1), \
                patch.object(probe.urllib.request, "build_opener", return_value=opener), \
                patch.object(opener, "open", side_effect=lambda *args, **kwargs: time.sleep(3)), \
                contextlib.redirect_stdout(output):
            self.assertEqual(probe.main(), 3)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(json.loads(output.getvalue()), {"error": "deadline"})
        self.assert_sanitized(output.getvalue())

    def test_pinned_version_must_be_exact_integer_seven(self):
        for version in (None, True, "7", 6, 8, 7):
            responses = successful_responses()
            responses[-1] = Response({"version": version})
            code, opener, output, stderr = run(responses)
            self.assertEqual(json.loads(output.splitlines()[-1])["matches_pinned_contract"], type(version) is int and version == 7)
            self.assert_sanitized(output, stderr)


if __name__ == "__main__":
    unittest.main()
