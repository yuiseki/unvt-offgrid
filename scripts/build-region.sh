#!/usr/bin/env bash
# Cut one region out of a planet archive along its polygon.
#
#   scripts/build-region.sh <planet.pmtiles or URL> <regions/NAME.geojson> <out.pmtiles> [maxzoom]
#
# The archive is cut to the polygon, not to its bounding box, so it has no
# tiles over the surrounding sea; the app answers those with the ocean tile
# (see src/tiles.ts).
set -euo pipefail
PLANET=${1:?planet}
REGION=${2:?region geojson}
OUT=${3:?output}
MAXZOOM=${4:-14}
pmtiles extract "$PLANET" "$OUT" --region="$REGION" --maxzoom="$MAXZOOM"
pmtiles verify "$OUT"
stat -c '%s bytes  %n' "$OUT"
