#!/usr/bin/env bash
# Stand-in archives for the e2e tests, cut from the planet archive:
#   kanto-z6.pmtiles     the Kanto polygon, zoom 0-6 (~1.5 MB); used for every
#                        archive under Kanto unless a more specific one exists
#   tokyo-box.pmtiles    a small box around Shinjuku, zoom 0-12
#   kanagawa-box.pmtiles a small box around Yokohama station, zoom 0-12
# The two boxes do not touch at zoom 12, so each shows land only where the
# other has none: what the overlay test needs.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p e2e/fixtures
PLANET=${PLANET:-https://z.yuiseki.net/static/openstreetmap/planet/planet.pmtiles}
F=e2e/fixtures
[ -s $F/kanto-z6.pmtiles ] || pmtiles extract "$PLANET" $F/kanto-z6.pmtiles --region=regions/kanto.geojson --maxzoom=6
[ -s $F/tokyo-box.pmtiles ] || pmtiles extract "$PLANET" $F/tokyo-box.pmtiles --bbox=139.69,35.685,139.71,35.70 --maxzoom=12
[ -s $F/kanagawa-box.pmtiles ] || pmtiles extract "$PLANET" $F/kanagawa-box.pmtiles --bbox=139.61,35.46,139.63,35.475 --maxzoom=12
