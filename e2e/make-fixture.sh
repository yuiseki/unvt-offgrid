#!/usr/bin/env bash
# The e2e stand-in for the Kanto archive: same polygon, zoom 0-6 only (~1.5 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=e2e/fixtures/kanto-z6.pmtiles
[ -s "$OUT" ] && exit 0
mkdir -p e2e/fixtures
PLANET=${PLANET:-https://z.yuiseki.net/static/openstreetmap/planet/planet.pmtiles}
pmtiles extract "$PLANET" "$OUT" --region=regions/kanto.geojson --maxzoom=6
