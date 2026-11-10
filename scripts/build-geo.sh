#!/usr/bin/env bash
# Build the outlines drawn on the region selection map, and the polygon each
# region archive is cut to, from Natural Earth 10m (public domain).
#
#   scripts/build-geo.sh <directory with ne_10m_admin_0_countries.shp and ne_10m_admin_1_states_provinces.shp>
#
# Writes public/geo/*.geojson (simplified, shipped with the app) and
# regions/*.geojson (full resolution, for `pmtiles extract --region`).
set -euo pipefail

NE=${1:?usage: $0 <natural earth shapefile dir>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/public/geo"
REG="$ROOT/regions"
mkdir -p "$OUT" "$REG"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

A0="$NE/ne_10m_admin_0_countries.shp"
A1="$NE/ne_10m_admin_1_states_provinces.shp"
gj() { ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=4 -lco RFC7946=YES "$@"; }

# World: every country, coarse. Only drawn as a backdrop.
rm -f "$OUT/world.geojson"
ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=2 -lco RFC7946=YES "$OUT/world.geojson" "$A0" -simplify 0.2 \
  -sql "SELECT ADM0_A3 AS id FROM ne_10m_admin_0_countries"

# Japan as a single pickable shape on the world map.
rm -f "$OUT/japan.geojson"
gj "$OUT/japan.geojson" "$A0" -simplify 0.01 \
  -sql "SELECT 'japan' AS id FROM ne_10m_admin_0_countries WHERE ADM0_A3 = 'JPN'"

# Japan's prefectures: backdrop when Japan is open.
rm -f "$OUT/japan-prefectures.geojson"
gj "$OUT/japan-prefectures.geojson" "$A1" -simplify 0.005 \
  -sql "SELECT iso_3166_2 AS id FROM ne_10m_admin_1_states_provinces WHERE iso_a2 = 'JP'"

# Kanto: Ibaraki, Tochigi, Gunma, Saitama, Chiba, Tokyo (with the Izu and
# Ogasawara islands and Minamitorishima) and Kanagawa, merged.
ogr2ogr -f GeoJSON "$TMP/kanto-prefs.geojson" "$A1" \
  -sql "SELECT iso_3166_2 FROM ne_10m_admin_1_states_provinces WHERE iso_3166_2 IN ('JP-08','JP-09','JP-10','JP-11','JP-12','JP-13','JP-14')"
rm -f "$REG/kanto.geojson" "$OUT/kanto.geojson"
ogr2ogr -f GeoJSON -lco RFC7946=YES "$REG/kanto.geojson" "$TMP/kanto-prefs.geojson" -dialect sqlite -nln kanto \
  -sql "SELECT 'kanto' AS id, ST_Union(geometry) AS geometry FROM ne_10m_admin_1_states_provinces"
gj "$OUT/kanto.geojson" "$REG/kanto.geojson" -simplify 0.005

ls -l "$OUT" "$REG"
