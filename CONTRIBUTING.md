# Contributing reports

Every run of an agent on a paper is one Markdown file. To add runs, open a pull request. CI checks the files, a maintainer merges the PR, and the site rebuilds.

Only submit papers your agent actually ran to the end. Papers skipped because there is nothing to run (no repo, empty repo, closed API only, private data, data-only, survey) are not recorded, and neither are cancelled, blocked or broken runs.

## One file per run

```
reports/<venue>/<paper_id>_<YYYY-MM-DD-T-HH-MM-SS>.md
```

`YYYY-MM-DD-T-HH-MM-SS` is the run's start time, e.g. `2026-10-08-T-02-26-50` for 2026-10-08 02:26:50. Several runs of the same paper are fine; give each its own start time. The site shows the latest one by default and lists the rest.

The file starts with a short YAML front matter ([schema](schema/report.schema.json)) in three sections. Everything else goes in the free-form Markdown write-up after it, which the site renders as the report.

```markdown
---
paper:
  venue: acl-2026-main
  paper_id: 2026.acl-long.1015
  title: Template-assisted Contrastive Learning of Task-oriented Dialogue Sentence Embeddings
  paper_url: https://aclanthology.org/2026.acl-long.1015
  code_link: https://github.com/minsik-ai/Template-Contrastive-Embedding
environment:
  timestamp: 2026-10-08-T-02-26-50
  harness: Claude Code
  model: Opus 5.5
  code_commit: 731051d
  gpu: 1x H200
  runtime: 918.8
result:
  codebase_completeness: MISSING_SCRIPTS
  result_as_released: DOES_NOT_RUN
  result_after_fixes: NUMBERS_MATCH
  coverage: FULL
  flags: [CODE_BUG, DATA_MISMATCH, BASELINE_STRONGER_THAN_REPORTED]
  comparisons:
  - {source: "Table 2, SNIPS", metric: intent accuracy (%) kNN k=1, setting: SimCSE, paper: 91.71, ours_as_released: 91.71, match_as_released: NUMBERS_MATCH, ours: 91.71, match: NUMBERS_MATCH}
  - ...
---

# Reproduction report

...
```

### Front matter

| Field | Meaning |
|---|---|
| `paper.venue` | Venue id; must be listed in [venues.yaml](venues.yaml) and equal the folder name. To add a venue, add it there in your PR |
| `paper.paper_id` | Must match the file name; see the table below |
| `paper.title`, `paper.paper_url` | As published |
| `paper.code_link` | The authors' code repository that was run |
| `environment.timestamp` | Run start time; must match the file name |
| `environment.harness` | Agent harness, e.g. `Claude Code`, `OpenHands`, `Codex CLI` |
| `environment.model` | Backbone model, e.g. `Opus 5.5` |
| `environment.code_commit` | Optional. Commit of `code_link` the run started from (the released version, before any fixes) |
| `environment.gpu` | GPUs used, e.g. `1x H200`, or `none` |
| `environment.runtime` | Optional. Wall-clock time of the run, in minutes |
| `result.codebase_completeness` | How much of the release worked: `RUNS_AS_IS` → `TRIVIAL_FIXES` → `MINOR_FIXES` → `MAJOR_FIXES` → `MISSING_SCRIPTS` / `MISSING_DATA` / `MISSING_CORE` (the most severe that applies) |
| `result.result_as_released` | Result with the release as published, no source edits |
| `result.result_after_fixes` | Result after the agent's fixes. Both use `NUMBERS_MATCH`, `TREND_MATCH`, `MIXED`, `NO_MATCH` or `DOES_NOT_RUN` |
| `result.coverage` | `FULL`, `SUBSET`, `SCALED_DOWN` or `NONE` |
| `result.flags` | Optional: `METHOD_MISMATCH` (code implements a different method), `CODE_BUG` (a bug changes what the code computes), `EVAL_MISMATCH`, `DATA_MISMATCH` (evaluation / data differ from the paper), `BASELINE_STRONGER_THAN_REPORTED`, `RERUN_WEAKER_THAN_RELEASED` |
| `result.comparisons` | Optional, recommended: one row per number compared with the paper (below). The site shows it as a table above the write-up |

The site's [Contribute page](https://reproducibility-hub.github.io/#/contribute) defines every label.

Each `comparisons` row has `source` (where the paper reports it, e.g. `Table 2, SNIPS`), `metric`, `setting` (method or condition), `paper`, `ours` and `match`; optionally `scope` (`main` / `supplementary`), and `ours_as_released` / `match_as_released` when the unmodified release was run too. A row's match can also be `NOT_COMPARABLE` (the setting differs too much) or `null` (not run). Extra columns are allowed. The reports seeded from our ACL 2026 study all include it, if you want an example.

`paper_id` comes from the venue:

| Source | `paper_id` |
|---|---|
| ACL Anthology | Anthology ID, e.g. `2026.acl-long.15` |
| OpenReview (ICLR, NeurIPS, ...) | forum ID, e.g. `aBcD123xYz` |
| arXiv-only | arXiv ID without version, e.g. `'2501.01234'` (quoted, or YAML reads it as a number) |

If the paper already has a report, copy its `paper` section. CI warns when they disagree, and the site shows the newest copy.

### Write-up

The write-up is free-form, but readers should be able to check your judgement from it. Include:

- which results in the paper you tried to reproduce, and the exact commands you ran
- a paper-vs-reproduced table for every number you compared (or `result.comparisons`)
- every change you made to the released code, and every script you had to write
- where the code and the paper disagree
- anything that was scaled down or not run, and why

Link large logs or outputs instead of pasting them. A report should stay under a few MB.

## Who can change a report

Anyone can add a report. Changing or deleting an existing report is reserved for the GitHub user who added it; CI enforces this, and flags the PR for a maintainer's review when it can't tell who added the file.

## Check, then open the PR

```bash
pip install jsonschema pyyaml
python scripts/validate.py                 # schema, file names, venues
python scripts/build.py && python -m http.server -d _site 8000   # preview at localhost:8000
```

Hundreds of reports in one PR are fine.

## Don't commit

- API keys, tokens, account e-mails, internal hostnames or cluster job IDs
- Model weights, datasets or large logs. Link them from the write-up instead

## Exporting from your own pipeline

[scripts/report.py](scripts/report.py) reads and writes report files: `dumps(meta, write_up)` turns the front matter dict and the write-up into the file's text. [scripts/import_hf_dashboard.py](scripts/import_hf_dashboard.py) shows a full conversion: `attempt_to_report()` turns one pipeline record into a report file.
