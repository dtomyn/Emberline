#!/usr/bin/env bash
# Fetches the kokoro-onnx v1.0 model files into data/kokoro (gitignored, about 330 MB), the same files and
# SHA-256 pins as .github/workflows/pages.yml (the IRISIdeas copies). Bump them together.
# Skips files that are already present and verified.
set -euo pipefail

DIR="${KOKORO_DIR:-data/kokoro}"
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
mkdir -p "$DIR"
cd "$DIR"

cat > SHA256SUMS <<'EOF'
7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5  kokoro-v1.0.onnx
bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  voices-v1.0.bin
EOF

for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ -f "$f" ] && grep " $f\$" SHA256SUMS | sha256sum -c --quiet - 2>/dev/null; then
    echo "$f already here"
    continue
  fi
  echo "Downloading $f"
  curl -fSL --progress-bar -o "$f.part" "$BASE/$f"
  mv "$f.part" "$f"
done

sha256sum -c SHA256SUMS
rm SHA256SUMS
echo "Kokoro model ready in $DIR; run: npm run make:voice"
