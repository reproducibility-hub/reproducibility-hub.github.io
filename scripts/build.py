#!/usr/bin/env python3
"""Build the static site into _site/.

    python scripts/build.py && python -m http.server -d _site 8000

_site/data/index.json holds the venues (from venues.yaml), every paper and every run's front matter
(what the dashboard and its filters need). Paper info is repeated in every report of that paper; the
newest report's copy wins. Each run's write-up and comparison table go to
_site/data/runs/<venue>/<paper_id>_<timestamp>.json and are fetched when the run is opened.
"""
import hashlib
import json
import shutil
from datetime import datetime, timezone

import yaml

import report as rp

ROOT = rp.ROOT
SITE, OUT = ROOT / "site", ROOT / "_site"


def write_json(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SITE, OUT)
    shutil.copytree(ROOT / "schema", OUT / "schema")

    venues = {vid: {"id": vid, **v} for vid, v in (yaml.safe_load((ROOT / "venues.yaml").read_text()) or {}).items()}
    papers, runs = {}, []
    files = sorted(rp.REPORTS.glob("*/*.md"), key=lambda f: rp.parse_name(f.name)["timestamp"])
    for f in files:
        meta, write_up = rp.load(f)
        paper = meta["paper"]
        papers[f"{paper['venue']}/{paper['paper_id']}"] = paper
        rid = rp.run_id(f)
        result = dict(meta["result"])
        comparisons = result.pop("comparisons", [])
        runs.append({"id": rid, "venue": paper["venue"], "paper_id": paper["paper_id"],
                     **meta["environment"], **result, "n_comparisons": len(comparisons)})
        write_json(OUT / "data" / "runs" / f"{rid}.json", {"report": write_up, "comparisons": comparisons})

    write_json(OUT / "data" / "index.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "venues": venues, "papers": papers, "runs": runs,
    })
    # Version the script and stylesheet URLs by content, so browsers don't keep a stale copy after a deploy.
    index = OUT / "index.html"
    html = index.read_text()
    for asset in ("app.js", "style.css"):
        digest = hashlib.sha256((OUT / asset).read_bytes()).hexdigest()[:10]
        assert f'"{asset}"' in html, asset
        html = html.replace(f'"{asset}"', f'"{asset}?v={digest}"')
    index.write_text(html)
    (OUT / ".nojekyll").touch()
    size = (OUT / "data" / "index.json").stat().st_size
    print(f"built {len(runs)} runs, {len(papers)} papers -> {OUT} (index.json {size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
