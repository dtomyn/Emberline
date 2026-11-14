#!/usr/bin/env bash
# Runs once when the dev container is created (devcontainer.json → postCreateCommand).
#
# Installs the pinned Kokoro packages into a venv in the home folder (KOKORO_PYTHON points at it), so the
# Linux venv never lands in the workspace that the host also sees. The model files are not fetched here:
# run .devcontainer/kokoro-model.sh when you want the narration. Nothing here touches data/ or the database.
set -euo pipefail

echo "Node $(node --version), $(python3 --version)"

VENV="$HOME/.venvs/kokoro"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
# A failed install must not fail the container: the app runs without Kokoro (the film uses the browser voice).
if "$VENV/bin/pip" install -q --disable-pip-version-check -r scripts/kokoro-requirements.txt; then
  echo "Kokoro packages installed in $VENV"
else
  echo "Kokoro packages did not install; npm run make:voice will not work until they do." >&2
fi

cat <<'EOF'

Emberline dev container is ready.
  npm test
  npm run load:cnfdb      # real data into data/wildfire.db (or: npm run load:mock)
  npm start               # http://localhost:5173 (forwarded to your machine)
  bash .devcontainer/kokoro-model.sh && npm run make:voice   # optional narration
EOF
