"""Serialize FKD builds and browser jobs across worktrees on macOS/Linux."""

import fcntl
import os
import signal
import subprocess
import sys
import time


def run():
    environment = dict(os.environ, FKD_HEAVY_LOCK="1")
    process = subprocess.Popen(sys.argv[1:], env=environment, start_new_session=True)
    interrupted = 0

    def forward_signal(number, _frame):
        nonlocal interrupted
        interrupted = number
        if process.poll() is None:
            os.killpg(process.pid, number)

    signal.signal(signal.SIGINT, forward_signal)
    signal.signal(signal.SIGTERM, forward_signal)
    status = process.wait()
    if interrupted:
        while True:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        if status == 0:
            return 128 + interrupted
    return status if status >= 0 else 128 - status


if os.environ.get("FKD_HEAVY_LOCK") == "1":
    sys.exit(run())

with open("/tmp/fkd-heavy-jobs.lock", "a") as lock:
    print("Waiting for the shared FKD heavy-job lock...", flush=True)
    fcntl.flock(lock, fcntl.LOCK_EX)
    sys.exit(run())
