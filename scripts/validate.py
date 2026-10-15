#!/usr/bin/env python3
"""Check every report under reports/ before it is merged.

    python scripts/validate.py                                             # whole repo
    python scripts/validate.py --base origin/main --author <github-user>   # what CI runs on a PR

With --base, only reports changed since <base> are checked. Anyone may add a report; a report
that already exists at <base> may only be changed or deleted by the GitHub user who added it.
That user is looked up through the GitHub API (`gh`, in CI); when it can't be determined, the
change is flagged for a maintainer's review instead.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

import report as rp

ROOT, REPORTS = rp.ROOT, rp.REPORTS
SCHEMA = Draft202012Validator(json.loads((ROOT / "schema" / "report.schema.json").read_text()))
LAYOUT = "reports/<venue>/<paper_id>_<YYYY-MM-DD-T-HH-MM-SS>.md"

errors, warnings = [], []


def err(path, msg):
    errors.append(f"{path}: {msg}")


def section(meta, name):
    s = meta.get(name) if isinstance(meta, dict) else None
    return s if isinstance(s, dict) else {}


def check_file(path, venues):
    """Schema, file name, venue and write-up checks for one report. Returns its front matter, or None."""
    rel = path.relative_to(ROOT)
    name = rp.parse_name(path.name)
    if len(path.relative_to(REPORTS).parts) != 2 or not name:
        return err(rel, f"reports must be named {LAYOUT}")
    try:
        meta, write_up = rp.load(path)
    except (OSError, ValueError, yaml.YAMLError) as e:
        return err(rel, f"can't read the front matter ({e})")
    for e in sorted(SCHEMA.iter_errors(meta), key=lambda e: list(map(str, e.path))):
        err(rel, f"{'.'.join(map(str, e.path)) or '(front matter)'}: {e.message}")
    expect = {("paper", "venue"): path.parent.name, ("paper", "paper_id"): name["paper_id"],
              ("environment", "timestamp"): name["timestamp"]}
    for (sec, key), want in expect.items():
        if section(meta, sec).get(key) != want:
            err(rel, f"{sec}.{key} is {section(meta, sec).get(key)!r} but the path says {want!r}")
    if path.parent.name not in venues:
        err(rel, f"unknown venue {path.parent.name!r}: it must be listed in venues.yaml")
    if not write_up.strip():
        err(rel, "the write-up (Markdown after the front matter) is empty")
    return meta


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def added_by(base, rel):
    """GitHub login of whoever added <rel> (as of <base>), or None if it can't be determined."""
    shas = git("log", base, "--diff-filter=A", "--format=%H", "--", rel).split()
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not shas or not repo or not shutil.which("gh"):
        return None
    r = subprocess.run(["gh", "api", f"repos/{repo}/commits/{shas[-1]}", "--jq", ".author.login // empty"],
                       cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip() or None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="git ref to diff against (PR mode)")
    ap.add_argument("--author", help="GitHub user who opened the PR (PR mode)")
    args = ap.parse_args()

    venues = yaml.safe_load((ROOT / "venues.yaml").read_text()) or {}
    for vid, v in venues.items():
        if not isinstance(v, dict) or not v.get("name"):
            err("venues.yaml", f"{vid}: needs a name")

    changed = None
    if args.base:
        # --no-renames: a moved file shows up as a delete plus an add, so the old path gets an ownership check.
        changed = [l for l in git("diff", "--name-only", "--no-renames", f"{args.base}...HEAD").splitlines()
                   if l.startswith("reports/")]

    for f in REPORTS.rglob("*"):
        if f.is_file() and f.suffix != ".md":
            err(f.relative_to(ROOT), f"only report files ({LAYOUT}) belong under reports/")
    files = sorted(REPORTS.glob("**/*.md"))
    todo = [f for f in files if changed is None or str(f.relative_to(ROOT)) in changed]
    metas = {f: check_file(f, venues) for f in todo}

    # Paper info is repeated in every report of that paper; flag a changed file that disagrees with the others.
    if todo:
        others = {}
        for f in files:
            if f in metas:
                continue
            try:
                m = rp.load(f)[0]
            except (OSError, ValueError, yaml.YAMLError):
                continue
            others.setdefault(f"{f.parent.name}/{section(m, 'paper').get('paper_id')}", section(m, "paper"))
        for f, m in metas.items():
            key = f"{f.parent.name}/{section(m, 'paper').get('paper_id')}"
            if m and key in others and others[key] != section(m, "paper"):
                fields = sorted(k for k in set(others[key]) | set(section(m, "paper"))
                                if others[key].get(k) != section(m, "paper").get(k))
                warnings.append(f"{f.relative_to(ROOT)}: {', '.join(f'paper.{k}' for k in fields)} disagrees with "
                                f"other reports for {key}; the site shows the newest. Needs a maintainer's review")

    # PR ownership: changing or deleting an existing report is reserved for whoever added it.
    if changed is not None and args.author:
        for rel in changed:
            if not rp.parse_name(Path(rel).name):
                continue
            if subprocess.run(["git", "cat-file", "-e", f"{args.base}:{rel}"], cwd=ROOT,
                              capture_output=True).returncode != 0:
                continue  # a new report: anyone may add one
            owner = added_by(args.base, rel)
            if owner is None:
                warnings.append(f"{rel}: changes an existing report, but who added it couldn't be determined. "
                                f"Needs a maintainer's review")
            elif owner != args.author:
                err(rel, f"@{args.author} can't change or delete this report: it was added by @{owner}")

    for w in warnings:
        print(f"::warning::{w}")
    for e in errors:
        print(f"::error::{e}")
    print(f"checked {len(todo)} of {len(files)} report(s): {len(errors)} error(s), {len(warnings)} warning(s)",
          file=sys.stderr)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
