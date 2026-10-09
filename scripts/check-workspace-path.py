#!/usr/bin/env python3
"""Guard against workspace paths that tools silently mis-resolve.

The failure it prevents: a project folder whose name ends with a space (or other
whitespace) collides with a sibling created at the whitespace-stripped path, so a
directory listing returns nothing and an agent concludes the repo is empty.

Usage:
  check-workspace-path.py <path>     # exit 0 = usable, 1 = blocked, 2 = fragile
  check-workspace-path.py --self-test
"""
import os
import sys
import tempfile

WHITESPACE = " \t\n\r\v\f\u00a0\u2000\u2001\u2002\u2003\u202f\u3000"


def _segments(path):
    return [p for p in path.split(os.sep) if p]


def findings(path):
    """Return (errors, warnings) for a candidate workspace root."""
    errors, warnings = [], []
    if not path.startswith(os.sep):
        errors.append(f"not an absolute path: {path!r}")
    if not os.path.exists(path):
        errors.append(f"path does not exist: {path!r}")
    elif not os.path.isdir(path):
        errors.append(f"path is a file, not a directory: {path!r}")

    prefix = os.sep
    for seg in _segments(path):
        exact = os.path.join(prefix, seg)
        stripped = seg.strip(WHITESPACE)
        if seg != stripped:
            warnings.append(f"segment has leading/trailing whitespace: {seg!r}")
            sibling = os.path.join(prefix, stripped)
            if stripped and os.path.lexists(sibling):
                kind = "directory" if os.path.isdir(sibling) else "file"
                errors.append(
                    f"whitespace path segment {exact!r} collides with sibling "
                    f"{kind} at {sibling!r}; tools may resolve to the wrong target"
                )
        prefix = exact
    return errors, warnings


def report(path):
    errors, warnings = findings(path)
    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"BLOCK: {e}")
    if errors:
        return 1
    if warnings:
        print("Fragile but usable. Rename to a canonical path to remove the hazard.")
        return 2
    print("OK: workspace path is canonical and unambiguous.")
    return 0


def self_test():
    ok = True

    def check(name, got, want):
        nonlocal ok
        status = "pass" if got == want else "FAIL"
        if got != want:
            ok = False
        print(f"  [{status}] {name} (exit {got}, want {want})")

    with tempfile.TemporaryDirectory() as root:
        n = 0

        def fresh():
            nonlocal n
            n += 1
            parent = os.path.join(root, f"case{n}")
            os.mkdir(parent)
            return parent

        clean = os.path.join(fresh(), "app")
        os.mkdir(clean)
        check("clean directory", report(clean), 0)

        fragile = os.path.join(fresh(), "app ")
        os.mkdir(fragile)
        check("trailing-space dir, no decoy", report(fragile), 2)

        collision = fresh()
        os.mkdir(os.path.join(collision, "app "))
        with open(os.path.join(collision, "app"), "w"):
            pass
        check("trailing-space dir + 0-byte decoy file",
              report(os.path.join(collision, "app ")), 1)

        check("relative path", report("app"), 1)
        check("missing path", report(os.path.join(fresh(), "nope")), 1)

        afile = os.path.join(fresh(), "afile")
        with open(afile, "w"):
            pass
        check("path is a file", report(afile), 1)

        nbsp = os.path.join(fresh(), "app\u00a0")
        os.mkdir(nbsp)
        check("no-break-space dir", report(nbsp), 2)

        parent = fresh()
        padded = os.path.join(parent, "outer ")
        os.makedirs(os.path.join(padded, "child"))
        check("padded parent without collision", report(os.path.join(padded, "child")), 2)
        with open(os.path.join(parent, "outer"), "w"):
            pass
        check("padded parent with file collision", report(os.path.join(padded, "child")), 1)
        os.unlink(os.path.join(parent, "outer"))
        os.mkdir(os.path.join(parent, "outer"))
        check("padded parent with directory collision", report(os.path.join(padded, "child")), 1)

    print("SELF-TEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        sys.exit(self_test())
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(report(sys.argv[1]))