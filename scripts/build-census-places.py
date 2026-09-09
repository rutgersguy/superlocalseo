#!/usr/bin/env python3
"""Rebuild the pinned public-domain Census scan-area dataset (not business addresses)."""
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip'
SHA256 = '15f4977a010cc42308f4d5ddc5e19f26ef63fc035f20745333a14b78aa08d3fa'
with urllib.request.urlopen(SOURCE, timeout=60) as response:
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
raw = archive.read('2025_Gaz_place_national.txt')
assert hashlib.sha256(raw).hexdigest() == SHA256, 'Source changed: review before updating the pinned digest'
rows = list(csv.DictReader(io.StringIO(raw.decode()), delimiter='|'))
places = [dict(id=r['GEOID'], name=r['NAME'] + ', ' + r['USPS'], lat=float(r['INTPTLAT']), lng=float(r['INTPTLONG'])) for r in rows if r['USPS'] != 'PR']
assert len(places) == 32058 and len({p['id'] for p in places}) == len(places)
assert all(-80 <= p['lat'] <= 80 and -180 <= p['lng'] <= 180 for p in places)
output = Path(__file__).resolve().parents[1] / 'backend/src/data/us-places-2025.json'
output.write_text(json.dumps(places, separators=(',', ':')) + '\n')
print(f'Validated {len(places)} unique areas; wrote {output}')
