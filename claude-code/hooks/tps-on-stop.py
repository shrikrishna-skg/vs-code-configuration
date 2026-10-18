#!/usr/bin/env python3
# Stop hook: show estimated output tokens/sec for the turn that just ended.
# Silent + exit 0 on any problem; never blocks.
# Run with --check to self-test the arithmetic.
import json
import os
import sys
from datetime import datetime


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def measure(entries):
    """(tokens, seconds, speeds) over the API responses since the last user prompt.

    Each response is timed from the user/tool-result entry before it to its last
    streamed block, so tool run time is excluded but time-to-first-token is not.
    """
    calls, prev, start = {}, {}, None  # message id -> [start, end, output_tokens, speed]
    for e in entries:
        if e.get("isSidechain") or "timestamp" not in e:
            continue
        m = e.get("message") or {}
        t = ts(e["timestamp"])
        if e.get("type") == "user":
            c = m.get("content")
            is_tool_result = isinstance(c, list) and any(b.get("type") == "tool_result" for b in c)
            if not e.get("isMeta") and not is_tool_result:
                prev, calls = calls or prev, {}  # a new prompt starts a new turn
            start = t
        elif e.get("type") == "assistant" and start is not None:
            u = m.get("usage") or {}
            c = calls.setdefault(m.get("id"), [start, t, 0, None])
            c[1] = max(c[1], t)
            c[2] = max(c[2], u.get("output_tokens") or 0)
            c[3] = u.get("speed") or c[3]
    calls = calls or prev  # prompt already logged but not answered yet: report the last turn
    tokens = sum(c[2] for c in calls.values())
    seconds = sum(c[1] - c[0] for c in calls.values())
    return tokens, seconds, sorted({c[3] for c in calls.values() if c[3]})


def check():
    def e(kind, sec, **msg):
        return {"type": kind, "timestamp": f"2026-01-01T00:00:{sec:02d}Z", "message": msg}

    tool_result = [{"type": "tool_result"}]
    entries = [
        e("user", 0, content="old prompt"),
        e("assistant", 9, id="old", usage={"output_tokens": 999}),
        e("user", 10, content="new prompt"),
        e("assistant", 12, id="a", usage={"output_tokens": 100, "speed": "standard"}),
        e("assistant", 14, id="a", usage={"output_tokens": 100, "speed": "standard"}),
        e("user", 44, content=tool_result),  # 30s tool run must not count
        e("assistant", 46, id="b", usage={"output_tokens": 200, "speed": "fast"}),
    ]
    assert measure(entries) == (300, 6.0, ["fast", "standard"]), measure(entries)
    entries.append(e("user", 50, content="next prompt, not answered yet"))
    assert measure(entries) == (300, 6.0, ["fast", "standard"]), measure(entries)
    print("ok")


def main():
    if os.environ.get("CLAUDE_BRIDGE_TOOL_MODE"):  # Kilo bridge decision steps
        return
    path = json.load(sys.stdin).get("transcript_path")
    # ponytail: re-reads the whole transcript every stop (fine to ~tens of MB);
    # if long sessions make this slow, seek to the tail and parse only that.
    with open(path) as f:
        entries = [json.loads(line) for line in f if line.strip()]
    tokens, seconds, speeds = measure(entries)
    if not (tokens and seconds > 0):
        return
    msg = f"{tokens / seconds:.0f} tok/s · {tokens} tokens in {seconds:.1f}s · speed: {'/'.join(speeds) or 'unknown'}"
    if "--prompt" in sys.argv:
        # UserPromptSubmit: the desktop app folds hook notices, so have Claude print
        # the previous reply's figure in the visible chat instead.
        ctx = (
            "User-requested speed readout. End your reply with this exact line on its own, "
            f"as plain text: Last reply: {msg}"
        )
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ctx}}))
    else:
        print(json.dumps({"systemMessage": msg}))


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        try:
            main()
        except Exception:
            pass
