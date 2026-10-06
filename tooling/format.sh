#!/bin/sh
# Formats files with oxfmt (install it yourself) using this repo's
# .oxfmtrc.json. Usage: tooling/format.sh <files...>
cd "$(dirname "$0")/.." && exec oxfmt -c .oxfmtrc.json --write "$@"
