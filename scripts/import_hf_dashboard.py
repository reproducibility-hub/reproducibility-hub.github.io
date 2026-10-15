#!/usr/bin/env python3
"""Import the attempts embedded in the old Hugging Face dashboard (index.html) or its
decoded data.json as report files under reports/.

    python scripts/import_hf_dashboard.py path/to/index.html --harness "Claude Code"

Only finished runs with a result are imported (see IMPORTED below). The venues they use must be
listed in venues.yaml.

Also a reference for exporters: a pipeline that already produces the old "attempt" dicts can call
attempt_to_report() and write the result per run.
"""
import argparse
import base64
import gzip
import json
import re
import sys
from pathlib import Path

import report as rp

# Old venue keys -> venue ids in venues.yaml
VENUES = {"ACL-main_2026": "acl-2026-main"}
# Only finished runs with a result are imported; skipped papers (no repo, closed API, ...) and
# cancelled, blocked or broken runs are left out.
IMPORTED = {"REPRODUCED", "PARTIALLY_REPRODUCED", "FAILED"}
# The old pipeline's CODE_PAPER_MISMATCH_MAJOR lumped every major code-vs-paper discrepancy together; the hub's
# METHOD_MISMATCH / CODE_BUG / EVAL_MISMATCH / DATA_MISMATCH flags come from classifying those discrepancies
# separately, so only the two flags below carry over directly.
FLAGS = {"BASELINE_STRONGER_THAN_REPORTED", "RERUN_WEAKER_THAN_RELEASED"}
GPU_TYPE = "H200"  # every run of the old pipeline used H200 nodes
MODEL_NAMES = {"claude-opus-5-5": "Opus 5.5", "claude-sonnet-5": "Sonnet 5"}


def load(path):
    text = Path(path).read_text()
    if path.endswith(".json"):
        return json.loads(text)
    blob = re.search(r'<script type="application/octet-stream" id="data">(.*?)</script>', text, re.S).group(1)
    return json.loads(gzip.decompress(base64.b64decode(blob.strip())))


def attempt_to_report(a, venue, harness):
    """One old-style attempt dict -> (report path, file text)."""
    ts = re.sub(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$", r"\1-\2-\3-T-\4-\5-\6", a["timestamp"])
    paper = {"venue": venue, "paper_id": a["anthology_id"], "title": a["title"], "paper_url": a["paper_url"],
             "code_link": a["code_link"]}
    env = {"timestamp": ts, "harness": harness, "model": MODEL_NAMES.get(a.get("model"), a.get("model"))}
    # The pipeline's diff starts with the commit it cloned, i.e. the released version.
    base = re.search(r"^base \(as cloned\): ([0-9a-f]{40})$", a.get("codebase_changes") or "", re.M)
    if base:
        env["code_commit"] = base.group(1)
    env["gpu"] = f"{a['gpus']}x {GPU_TYPE}" if a.get("gpus") else "none"
    if a.get("agent_minutes") is not None:
        env["runtime"] = a["agent_minutes"]
    result = {"codebase_completeness": a["codebase_completeness"], "result_as_released": a["result_match_as_released"],
              "result_after_fixes": a["result_match"], "coverage": a["coverage"]}
    flags = [f for f in a.get("flags") or [] if f in FLAGS]
    if flags:
        result["flags"] = flags
    if a.get("comparisons"):
        result["comparisons"] = a["comparisons"]
    path = rp.REPORTS / venue / f"{paper['paper_id']}_{ts}.md"
    return path, rp.dumps({"paper": paper, "environment": env, "result": result}, a.get("report") or "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="old dashboard index.html, or its decoded data.json")
    ap.add_argument("--harness", required=True, help='agent harness that produced the runs, e.g. "Claude Code"')
    args = ap.parse_args()

    d = load(args.source)
    n = 0
    for a in d["attempts"]:
        if a.get("verdict") not in IMPORTED or a.get("result_match") == "NOT_COMPARABLE":
            continue
        path, text = attempt_to_report(a, VENUES.get(a["venue"], a["venue"]), args.harness)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        n += 1
    print(f"imported {n} of {len(d['attempts'])} attempts into {rp.REPORTS}", file=sys.stderr)


if __name__ == "__main__":
    main()
