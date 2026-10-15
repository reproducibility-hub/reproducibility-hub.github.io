# Reproducibility Hub

**Released, but reproducible?** Agent-executed reproducibility reports for research code releases. An agent attempts a paper's main experiments from the released code, and writes down what ran, what it had to fix, and whether the numbers matched.

Site: https://reproducibility-hub.github.io

Every run is one Markdown file, contributed by pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

```
reports/<venue>/<paper_id>_<YYYY-MM-DD-T-HH-MM-SS>.md
    # YAML front matter: paper, environment (agent, model, code commit, compute), result (codebase level, result match, coverage, flags)
    # Markdown body: the free-form write-up
venues.yaml                                 # venue ids and display names
schema/report.schema.json                   # JSON Schema for the front matter
scripts/
  report.py                                 # read/write report files (shared by the scripts below)
  validate.py                               # schema + file-name + venue + PR ownership checks (CI)
  build.py                                  # reports/ -> _site/ (index.json + one write-up file per run)
site/                                       # static front end (no build step, no framework)
.github/workflows/
  validate.yml                              # runs on every PR
  deploy.yml                                # builds and deploys to GitHub Pages on push to main
```

`build.py` puts every run's front matter into `index.json`, which is all the dashboard needs. Each write-up goes into a separate file, fetched when someone opens that run, so the page stays fast as runs pile up.

## Local preview

```bash
pip install jsonschema pyyaml
python scripts/validate.py
python scripts/build.py && python -m http.server -d _site 8000
```
