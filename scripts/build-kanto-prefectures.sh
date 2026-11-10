#!/usr/bin/env bash
# Cut one archive per Kanto prefecture out of a planet archive, each along
# its Natural Earth 10m admin-1 polygon (the same method as regions/kanto).
#
#   scripts/build-kanto-prefectures.sh <natural earth shapefile dir> <planet.pmtiles or URL> <out dir> <tag>
#
# Writes regions/kanto/NAME.geojson (full resolution, for `pmtiles extract
# --region`) and <out dir>/NAME-<tag>.pmtiles, one prefecture at a time.
set -euo pipefail

NE=${1:?usage: $0 <natural earth shapefile dir> <planet> <out dir> <tag>}
PLANET=${2:?planet}
OUTDIR=${3:?out dir}
TAG=${4:?tag, e.g. 251124}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REG="$ROOT/regions/kanto"
mkdir -p "$REG" "$OUTDIR"

A1="$NE/ne_10m_admin_1_states_provinces.shp"

# iso_3166_2 and the name used for files and the feature id.
PREFS=(
  JP-08:ibaraki
  JP-09:tochigi
  JP-10:gunma
  JP-11:saitama
  JP-12:chiba
  JP-13:tokyo
  JP-14:kanagawa
)

# Polygons first, so a missing prefecture stops the run before any extract.
for p in "${PREFS[@]}"; do
  iso=${p%%:*} name=${p#*:}
  rm -f "$REG/$name.geojson"
  # Tokyo keeps all its parts: the Izu and Ogasawara islands and Minamitorishima.
  ogr2ogr -f GeoJSON -lco RFC7946=YES "$REG/$name.geojson" "$A1" -dialect sqlite -nln "$name" \
    -sql "SELECT '$name' AS id, ST_Union(geometry) AS geometry FROM ne_10m_admin_1_states_provinces WHERE iso_3166_2 = '$iso'"
  n=$(grep -c '"type": "Feature"' "$REG/$name.geojson" || true)
  # An aggregate over no rows still yields one feature, with a null geometry.
  if [ "$n" != 1 ] || grep -q '"geometry": null' "$REG/$name.geojson"; then
    echo "$iso ($name): expected 1 feature, got $n" >&2
    exit 1
  fi
done

# Extracts, one at a time.
for p in "${PREFS[@]}"; do
  name=${p#*:}
  "$ROOT/scripts/build-region.sh" "$PLANET" "$REG/$name.geojson" "$OUTDIR/$name-$TAG.pmtiles"
done

ls -l "$REG" "$OUTDIR"
