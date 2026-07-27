#!/bin/sh
# 一键：语法检查 → build → 跑场景
# 用法: sh www/_test/go.sh [shot|cards|sim|probe] [额外参数...]
# 截图输出在 $OUT（默认 /tmp/rpgtest），用 Read 工具直接看 s0_setup.png 等
set -e
OUT=${OUT:-/tmp/rpgtest}
mkdir -p "$OUT"
node --check www/rpg.js
node --check www/rpg3d.js
python3 www/_build_artifact.py "$OUT/test.html"
SCENE=${1:-shot}
shift 2>/dev/null || true
NODE_PATH=/opt/node22/lib/node_modules node www/_test/run.js "$SCENE" --out="$OUT" "$@"
