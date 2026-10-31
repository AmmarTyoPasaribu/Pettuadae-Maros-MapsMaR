"""Downloads points of interest (shops, restaurants, cafes, services...) around Pettuadae
from Overture Maps Places and writes them in the game's local metre coordinates.

Usage:  pip install duckdb   then   python scripts/fetch-places.py
Data: Overture Maps Foundation, Places theme (CDLA Permissive 2.0 / per-source licences).
"""
import json
import math
import duckdb

RELEASE = "2026-10-21.0"
LAT0, LON0 = -5.01425, 119.57761
RADIUS = 1320
OUT = "src/game/maros/data/pettuadae-places.json"

dlat = RADIUS / 110574
dlon = RADIUS / (111320 * math.cos(math.radians(LAT0)))
kx = math.cos(math.radians(LAT0)) * 111320

con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'; SET threads=4; SET http_retries=12; SET http_retry_wait_ms=800;")
rows = con.sql(f"""
  SELECT names."primary" AS name, basic_category AS basic, taxonomy."primary" AS cat, taxonomy.hierarchy AS hier,
         confidence, operating_status AS status, addresses[1].freeform AS addr, brand.names."primary" AS brand,
         ST_X(geometry) AS lon, ST_Y(geometry) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN {LON0 - dlon} AND {LON0 + dlon}
    AND bbox.ymin BETWEEN {LAT0 - dlat} AND {LAT0 + dlat}
""").fetchall()

places = []
for name, basic, cat, hier, conf, status, addr, brand, lon, lat in rows:
    if not name or (status and status not in ("open",)):
        continue
    x = (lon - LON0) * kx
    z = -(lat - LAT0) * 110574
    if math.hypot(x, z) > RADIUS:
        continue
    places.append({
        "name": name.strip(), "basic": basic or "", "cat": cat or "", "hier": list(hier or []),
        "conf": round(conf or 0, 2), "addr": addr or "", "brand": brand or "",
        "x": round(x, 1), "z": round(z, 1),
    })

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"source": f"Overture Maps Places {RELEASE}", "places": places}, f, ensure_ascii=False)

from collections import Counter
print("places:", len(places))
print("top basic categories:", Counter(p["basic"] for p in places).most_common(25))
print("sample:", [p["name"] for p in places[:30]])
