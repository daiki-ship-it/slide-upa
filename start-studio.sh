#!/bin/bash
cd "$(dirname "$0")/studio" || exit 1
if lsof -ti:3579 >/dev/null 2>&1; then
  echo "前回の studio を止めます…"
  lsof -ti:3579 | xargs kill -9 2>/dev/null || true
  sleep 0.5
fi
echo "slide-upa studio を起動します…"
echo "ブラウザで開く: http://localhost:3579/"
echo "止めるとき: この画面で Ctrl + C"
npm start
