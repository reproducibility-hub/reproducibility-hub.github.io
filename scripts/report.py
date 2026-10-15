"""Read and write report files.

A report is reports/<venue>/<paper_id>_<YYYY-MM-DD-T-HH-MM-SS>.md: YAML front matter
with paper, environment and result (schema/report.schema.json), then the free-form write-up as Markdown.
"""
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
FRONT = re.compile(r"\A---\n(.*?\n)---(?:\n|\Z)(.*)\Z", re.S)
# libyaml's loader is ~10x faster on these files; fall back to the pure-Python one if PyYAML was built without it.
_Loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
NAME = re.compile(r"^(?P<paper_id>[A-Za-z0-9._-]+)_(?P<timestamp>\d{4}-\d{2}-\d{2}-T-\d{2}-\d{2}-\d{2})\.md$")


def parse_name(name):
    """File name -> {paper_id, timestamp}, or None if it doesn't follow the pattern."""
    m = NAME.match(name)
    return m.groupdict() if m else None


def run_id(path):
    """reports/<venue>/<stem>.md -> '<venue>/<stem>', the run's id on the site."""
    return f"{Path(path).parent.name}/{Path(path).stem}"


def loads(text):
    """Report file text -> (front matter dict, write-up). Raises ValueError or yaml.YAMLError."""
    m = FRONT.match(text.replace("\r\n", "\n"))
    if not m:
        raise ValueError("no YAML front matter: the file must start with a line '---' and the front matter must end with '---'")
    meta = yaml.load(m.group(1), Loader=_Loader)
    if not isinstance(meta, dict):
        raise ValueError("the front matter is not a YAML mapping")
    return meta, m.group(2)


def load(path):
    return loads(Path(path).read_text())


class _Dumper(yaml.SafeDumper):
    pass


def _str(dumper, s):
    # Multi-line strings (diffs, long notes) as | blocks; PyYAML falls back to quoting when a block can't hold them.
    return dumper.represent_scalar("tag:yaml.org,2002:str", s, style="|" if "\n" in s else None)


_Dumper.add_representer(str, _str)


def dumps(meta, write_up):
    front = yaml.dump(meta, Dumper=_Dumper, sort_keys=False, allow_unicode=True, width=1 << 30)
    return f"---\n{front}---\n\n{write_up.lstrip()}"
