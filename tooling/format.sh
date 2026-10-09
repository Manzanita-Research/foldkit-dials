#!/bin/sh
# Formats files with the root oxfmt installation using this repo's
# .oxfmtrc.json. Usage: tooling/format.sh <files...>
cd "$(dirname "$0")/.." && exec node_modules/.bin/oxfmt -c .oxfmtrc.json --write "$@"
