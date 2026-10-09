"""Synthetic availability failures must stop before any Alchemy invocation."""

import contextlib
import importlib.util
import io
import json
import pathlib
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load("preflight", "cloudflare_preflight.py")
fixtures = load("fixtures", "test_cloudflare_probe.py")


def healthy():
    return fixtures.successful_responses()[1:]


def run(responses, account=fixtures.ACCOUNT, token=fixtures.TOKEN):
    opener = fixtures.Opener(responses)
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        status = preflight.check(account, token, opener)
    for marker in (fixtures.ACCOUNT, fixtures.TOKEN, fixtures.MARKER, "https://", "Authorization", "Traceback"):
        assert marker not in stdout.getvalue() + stderr.getvalue()
    assert not stderr.getvalue()
    return status, opener, [json.loads(line) for line in stdout.getvalue().splitlines()]


class PreflightTests(unittest.TestCase):
    def test_ready_requires_all_four_gets_and_no_public_auth(self):
        status, opener, rows = run(healthy())
        self.assertEqual(status, 0)
        self.assertEqual(rows[-1], {"preflight_ready": True})
        self.assertEqual(len(opener.requests), 4)
        self.assertTrue(all(request.get_header("User-agent") == "node" for request, _ in opener.requests))
        self.assertTrue(all(request.get_method() == "GET" and request.data is None for request, _ in opener.requests))
        self.assertIsNone(opener.requests[-1][0].get_header("Authorization"))
        self.assertFalse(opener.active)

    def test_malformed_input_never_makes_a_request(self):
        for account, token in [(fixtures.ACCOUNT, fixtures.TOKEN + "\n"), (None, fixtures.TOKEN), (fixtures.ACCOUNT, "")]:
            status, opener, rows = run([], account, token)
            self.assertEqual(status, 1)
            self.assertEqual(opener.requests, [])
            self.assertEqual(rows[-1], {"error": "invalid_credentials"})

    def test_failed_metadata_stops_at_each_operation(self):
        for index in range(3):
            for http_status in (401, 403, 404, 500):
                responses = healthy()[:index] + [fixtures.Response({"errors": [{"code": 10000, "message": fixtures.TOKEN}]}, http_status)]
                status, opener, rows = run(responses)
                self.assertEqual(status, 1)
                self.assertEqual(len(opener.requests), index + 1)
                self.assertFalse(rows[-1]["preflight_ready"])

    def test_rate_limit_stops_without_retry_at_any_position(self):
        for index in range(4):
            response = fixtures.Response(None, 429, raw=fixtures.TOKEN.encode())
            status, opener, rows = run(healthy()[:index] + [response])
            self.assertEqual(status, 2)
            self.assertEqual(len(opener.requests), index + 1)
            self.assertEqual(response.read_sizes, [])
            self.assertTrue(rows[-1]["rate_limited"])

    def test_invalid_subdomain_cannot_control_the_public_host(self):
        for label in (None, "evil/path", "evil@host", "evil.example", "-evil", "x" * 64):
            status, opener, rows = run([fixtures.Response({"success": True, "result": {"subdomain": label}})])
            self.assertEqual(status, 1)
            self.assertEqual(len(opener.requests), 1)
            self.assertEqual(rows[-1]["error"], "workers_subdomain_unavailable")

    def test_store_requires_success_and_nonempty_list(self):
        for result in (None, [], {}, fixtures.MARKER, [None], [{}], [{"id": ""}], [{"id": 7}]):
            status, opener, rows = run(healthy()[:2] + [fixtures.Response({"success": True, "result": result})])
            self.assertEqual(status, 1)
            self.assertEqual(len(opener.requests), 3)
            self.assertEqual(rows[-1]["error"], "state_secrets_store_unavailable")

    def test_worker_metadata_requires_result_object(self):
        for result in (None, [], fixtures.MARKER):
            status, opener, rows = run(healthy()[:1] + [fixtures.Response({"success": True, "result": result})])
            self.assertEqual(status, 1)
            self.assertEqual(len(opener.requests), 2)
            self.assertEqual(rows[-1]["error"], "state_worker_unavailable")

    def test_contract_requires_integer_seven_and_http_200(self):
        for version in (None, True, "7", 6, 8):
            status, _, rows = run(healthy()[:3] + [fixtures.Response({"version": version})])
            self.assertEqual(status, 1)
            self.assertEqual(rows[-1]["error"], "state_contract_unavailable")
        for http_status in (302, 403, 404, 500):
            status, _, rows = run(healthy()[:3] + [fixtures.Response({"version": 7}, http_status)])
            self.assertEqual(status, 1)
            self.assertFalse(rows[-1]["preflight_ready"])

    def test_transport_error_is_failure_and_not_retried(self):
        status, opener, rows = run([RuntimeError(fixtures.TOKEN + fixtures.MARKER)])
        self.assertEqual(status, 1)
        self.assertEqual(len(opener.requests), 1)
        self.assertEqual(rows[-1]["error"], "workers_metadata_unavailable")


if __name__ == "__main__":
    unittest.main()
