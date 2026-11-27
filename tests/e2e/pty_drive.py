#!/usr/bin/env python3
"""PTY driver for Kalaga real-agent E2E regression.

Spawns `node <kala> <args…>` under a PTY, navigates common vendor trust
prompts, sends an exit, and answers Kalaga's clean-exit stay menu.

Exit codes:
  0  child exited; transcript + state left for the shell harness to assert
  1  usage / env error
  2  timed out (child killed)
"""
from __future__ import annotations

import argparse
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

CSI_RE = re.compile(r"\x1b\[[0-9;?<=>!]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b.")


def strip_ansi(raw: bytes | str) -> str:
    text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else raw
    text = CSI_RE.sub(" ", text)
    return re.sub(r"[ \t]+", " ", text)


def set_winsize(fd: int, rows: int = 40, cols: int = 120) -> None:
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def reply_term_queries(fd: int, raw: bytes) -> bool:
    replied = False
    if b"\x1b[c" in raw or b"\x1b[0c" in raw:
        os.write(fd, b"\x1b[?1;2c")
        replied = True
    if b"\x1b[>0q" in raw:
        os.write(fd, b"\x1bP>|pty_drive\x1b\\")
        replied = True
    if b"\x1b[?u" in raw:
        os.write(fd, b"\x1b[?0u")
        replied = True
    return replied


def main() -> int:
    ap = argparse.ArgumentParser(description="PTY-drive a Kalaga invocation")
    ap.add_argument("--kala", required=True)
    ap.add_argument("--cwd", required=True)
    ap.add_argument("--timeout", type=float, default=90.0)
    ap.add_argument("--log", default="")
    ap.add_argument("--agent-exit", default="/exit")
    ap.add_argument(
        "--wait-path",
        action="append",
        default=[],
        help="Relative path(s) under --cwd; delay /exit until each exists (or timeout)",
    )
    ap.add_argument(
        "--min-work-secs",
        type=float,
        default=0.0,
        help="After ready, wait at least this many seconds before /exit",
    )
    ap.add_argument(
        "--idle-secs",
        type=float,
        default=0.0,
        help="After wait-paths exist, wait until PTY output is quiet for N secs so the turn finishes",
    )
    ap.add_argument(
        "--pick-agent",
        default="",
        help="Agent key to select from Kalaga's continue/start picker (e.g. cursor)",
    )
    ap.add_argument("kala_args", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    wait_paths = [os.path.join(args.cwd, p) for p in (args.wait_path or [])]
    ready_since: float | None = None
    # argparse.REMAINDER keeps a leading "--"; callers may also pass one.
    # Strip every leading "--" so we never invoke bare `kala` (which is doStart).
    kala_args = list(args.kala_args)
    while kala_args and kala_args[0] == "--":
        kala_args = kala_args[1:]
    if not kala_args:
        print("pty_drive: missing kala args after --", file=sys.stderr)
        return 1
    print(f"pty_drive: exec node {args.kala} {' '.join(kala_args)}", flush=True)

    os.environ.setdefault("TERM", "xterm-256color")
    os.environ.setdefault("COLORTERM", "truecolor")

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(args.cwd)
        os.execvp("node", ["node", args.kala, *kala_args])

    set_winsize(fd)
    deadline = time.time() + args.timeout
    out = bytearray()
    phase = "boot"  # boot → trust → ready → working → exiting → stay → done
    last_action = 0.0
    last_rx = time.time()
    paths_logged = False
    queries_done = False
    pick_done = False
    kala_trust_done = False
    child_code: int | None = None
    trust_clicks = 0

    def act(label: str, payload: bytes) -> None:
        nonlocal last_action
        os.write(fd, payload)
        last_action = time.time()
        print(f"pty_drive: ACTION {label} phase={phase}", flush=True)

    def recent_plain(n: int = 1200) -> str:
        return strip_ansi(bytes(out[-n:])).lower()

    def work_done() -> bool:
        nonlocal ready_since, paths_logged
        if ready_since is None:
            ready_since = time.time()
            print("pty_drive: working (waiting for paths / min-work-secs)", flush=True)
        if args.min_work_secs and (time.time() - ready_since) < args.min_work_secs:
            return False
        for p in wait_paths:
            try:
                if os.path.getsize(p) <= 0:
                    return False
            except OSError:
                return False
        if wait_paths and not paths_logged:
            paths_logged = True
            print(f"pty_drive: wait-path satisfied: {wait_paths}", flush=True)
        if args.idle_secs and (time.time() - last_rx) < args.idle_secs:
            return False
        return True

    try:
        while time.time() < deadline:
            r, _, _ = select.select([fd], [], [], 0.35)
            if fd in r:
                try:
                    chunk = os.read(fd, 16384)
                except OSError:
                    break
                if not chunk:
                    break
                out.extend(chunk)
                last_rx = time.time()
                if not queries_done and len(out) > 200:
                    if reply_term_queries(fd, bytes(out)):
                        last_action = time.time()
                    queries_done = True

            now = time.time()
            if now - last_action < 1.2:
                w = os.waitpid(pid, os.WNOHANG)
                if w[0] == pid:
                    child_code = w[1] >> 8
                    break
                continue

            tail = recent_plain()

            # --- Kalaga startup / recover picker ---
            if args.pick_agent and not pick_done and phase == "boot" and (
                "continue on" in tail or "start with" in tail
            ):
                m = re.search(rf"\[(\d+)\]\s+{re.escape(args.pick_agent.lower())}\b", tail)
                if m:
                    pick_done = True
                    act(f"kala-pick-{args.pick_agent}", m.group(1).encode())
                    continue

            # --- Kalaga trust (cursor) ---
            if not kala_trust_done and phase in ("boot", "trust") and (
                "kalaga path trust" in tail or "trust this directory for kalaga" in tail
            ):
                kala_trust_done = True
                phase = "trust"
                act("kala-trust-y", b"y")
                continue

            # --- Vendor workspace trust (match RECENT screen only) ---
            if phase in ("boot", "trust") and (
                "trust this folder" in tail
                or "trust the contents of this project" in tail
                or "quick safety check" in tail
                or "is this a project you created" in tail
            ):
                phase = "trust"
                on_no = bool(re.search(r"[❯>]\s*no", tail))
                if on_no and trust_clicks < 5:
                    trust_clicks += 1
                    time.sleep(0.5)
                    act("vendor-trust-down", b"\x1b[B")
                    time.sleep(0.6)
                    act("vendor-trust-enter", b"\r")
                elif trust_clicks < 5:
                    trust_clicks += 1
                    act("vendor-trust-enter-yes", b"\r")
                else:
                    phase = "ready"  # give up on trust UI; hope session started
                continue

            # Advance out of trust once the chooser leaves the recent screen
            if (
                phase == "trust"
                and "trust this folder" not in tail
                and "trust the contents" not in tail
                and "quick safety check" not in tail
                and "is this a project you created" not in tail
            ):
                phase = "ready"
                print("pty_drive: trust screen cleared → ready", flush=True)

            # --- Ready → working → exit when wait conditions met ---
            ready_hints = (
                "escape to interrupt",
                "shift+tab",
                "type a message",
                "ask anything",
                "auto ·",
                "composer",
                "╭─",
                "generating",
                "thinking",
            )
            if phase in ("boot", "ready") and any(h in tail for h in ready_hints):
                phase = "working"
                ready_since = time.time()
                print("pty_drive: agent UI ready → working", flush=True)
                continue

            # boot with lots of output and no trust → treat as ready/working
            if phase == "boot" and len(out) > 5000 and "trust" not in tail:
                phase = "working"
                ready_since = time.time()

            if phase == "working":
                if work_done() or (time.time() > deadline - 25):
                    # leave ~25s for exit/stay before hard timeout
                    phase = "exiting"
                    time.sleep(0.5)
                    # Clear input line first (Ctrl+U) so stray bytes never prefix /exit
                    act("line-clear", b"\x15")
                    time.sleep(0.2)
                    act(f"agent-exit:{args.agent_exit}", args.agent_exit.encode() + b"\r")
                    time.sleep(0.6)
                    act("agent-exit-confirm", b"\r")
                continue

            # Cursor slash palette visible — confirm highlighted /exit
            if phase == "exiting" and ("/exit exit" in tail or "/quit exit" in tail):
                act("slash-confirm-enter", b"\r")
                continue

            if phase == "exiting":
                if any(x in tail for x in ("stay / back", "hand off, or stay", "nothing launched", "staying put")):
                    phase = "stay"
                    act("kala-stay-enter", b"\r")
                    continue
                if "continue on" in tail or "start with" in tail:
                    phase = "stay"
                    act("kala-stay-enter", b"\r")
                    continue
                if now - last_action > 12:
                    # Ctrl+C, Ctrl+U, /quit, and Ctrl+Q (Grok quit) as fallback
                    act("agent-ctrl-c", b"\x03\x15")
                    time.sleep(0.4)
                    act("agent-quit", b"/quit\r")
                    time.sleep(0.4)
                    act("agent-quit-confirm", b"\r\x11")
                    phase = "stay"
                    continue

            if phase == "stay":
                if "staying put" in tail or "nothing launched" in tail:
                    # Kalaga finished; reap or SIGTERM the wrapper if it lingers
                    time.sleep(0.5)
                    w = os.waitpid(pid, os.WNOHANG)
                    if w[0] == pid:
                        child_code = w[1] >> 8
                        break
                    try:
                        os.kill(pid, signal.SIGTERM)
                        time.sleep(0.8)
                        w = os.waitpid(pid, os.WNOHANG)
                        if w[0] == pid:
                            child_code = w[1] >> 8
                            break
                    except ProcessLookupError:
                        child_code = 0
                        break
                if now - last_action > 8:
                    act("kala-stay-q", b"q\r")
                    last_action = now

            w = os.waitpid(pid, os.WNOHANG)
            if w[0] == pid:
                child_code = w[1] >> 8
                break
        else:
            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.5)
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
            print(f"pty_drive: TIMEOUT phase={phase} out_len={len(out)}", flush=True)
            if args.log:
                open(args.log, "wb").write(out)
            print(strip_ansi(bytes(out))[-1800:], flush=True)
            return 2
    finally:
        if args.log:
            open(args.log, "wb").write(out)

    print(f"pty_drive: DONE child_exit={child_code} phase={phase} out_len={len(out)}", flush=True)
    print(strip_ansi(bytes(out))[-1800:], flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
