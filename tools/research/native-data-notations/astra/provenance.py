"""Read documented version headers, not legacy engine source or a second data parser.
Public decoder models can normalize a pre-vector board to minor 4. Record both.
Usage: python3 provenance.py SCRATCH_DIRECTORY
"""
import base64
from collections import Counter
import json
from pathlib import Path
import struct
import sys

scratch = Path(sys.argv[1])
payloads = [json.loads(line) for line in (scratch / 'payloads.jsonl').read_text().splitlines()]
decoded = {r['id']: r for r in (json.loads(line) for line in (scratch / 'decoded.jsonl').read_text().splitlines())}
mappings = json.loads((scratch / 'source-mappings.json').read_text())
selected = {m['source']: m for m in mappings}
headers = []
for row in payloads:
    data = base64.b64decode(row['base64'])
    version = {'encoding': 'not a versioned domain header', 'major': None, 'minor': None}
    if data.startswith(b'RPGTLKIT'):
        zero = data.find(b'\0')
        newline = data.find(b'\n')
        if zero >= 0 and (newline < 0 or zero < newline):
            if len(data) >= zero + 5:
                major, minor = struct.unpack_from('<hh', data, zero + 1)
                version = {'encoding': 'binary NUL header', 'major': major, 'minor': minor}
        else:
            lines = data.splitlines()
            try:
                version = {'encoding': 'legacy text', 'major': int(lines[1].strip()), 'minor': int(lines[2].strip())}
            except (IndexError, ValueError):
                version['encoding'] = 'header version unclassified'
    outcome = decoded[row['id']]['result']
    layout = outcome.get('value', {}).get('layout') if row['prior']['format'] == 'board' else None
    entry = {'id': row['id'], 'sha256': row['sha256'], 'game': row['game'], 'path': row['path'],
             'originUsed': row['originUsed'], 'format': row['prior']['format'], 'physicalHeader': version,
             'decoderLayout': layout, 'normalizedMajor': row['prior'].get('major'), 'normalizedMinor': row['prior'].get('minor'),
             'decoded': outcome['ok'], 'selected': row['id'] in selected}
    headers.append(entry)
    if row['id'] not in selected:
        continue
    mapping = selected[row['id']]
    mapping['physicalHeader'] = version
    mapping['decoderLayout'] = layout
    mapping['limitations'] = []
    if layout == 'pre-vector':
        mapping['limitations'].append('Board conversion drops registration, foreground/border, day/night and reserved fields; original bytes retained read-only. A normalized model is not a lossless legacy importer.')
    for field in mapping['fields']:
        key = field['source']
        if layout == 'pre-vector':
            classification = {
                'major': 'normalized model version, not physical header', 'minor': 'normalized model version, not physical header',
                'vectors': 'synthesized from tile-type collision cells; NOT authored vector objects',
                'programs': 'stored program/condition data plus synthesized cell regions, stop flag and repeat-distance default',
                'sprites': 'stored identities/conditions; tile positions converted to pixels; loading fields copied from initial conditions',
                'properties': 'mixed stored values, converted tile start/ambient preset, and version defaults',
                'constants': 'stored integer constants converted to decimal strings',
                'shadeLayers': 'converted from per-cell shading; highest nonzero layer rule',
                'tileRuns': 'normalized tile run representation, not proof of original run encoding',
                'images': 'synthesized empty modern image list; old foreground/border fields not represented',
                'lights': 'synthesized empty modern lights list',
                'coordType': 'stored when optional old byte exists; otherwise decoder 2D default',
                'sizeL': 'stored binary dimensions or fixed eight-layer text layout',
                'lut': 'stored binary LUT or interned tile names from text cells; indices in projected model retained',
            }.get(key, 'legacy stored field decoded, possibly normalized; see older-binary/text format catalogue')
        elif row['prior']['format'] == 'board':
            classification = 'stored vector-board field; tileMatrix expanded from stored runs, properties may apply documented start fallback'
        else:
            classification = 'decoded field corresponding to versioned format catalogue; not a raw byte offset claim'
            if key in ('movementAnimations', 'idleAnimations', 'speed', 'idleTime', 'vectorBases') and (version['minor'] or 0) < (8 if row['prior']['format'] == 'character' else 7):
                classification = 'version-sensitive: absent fields synthesized/defaulted or old tile presentation converted; do not infer authored modern field'
            if key == 'delay' and version['encoding'] == 'legacy text':
                classification = 'legacy text timing decoded to seconds; numeric units normalized'
            if key == 'residue':
                classification = 'opaque unmodeled/residual bytes; no forward contract assigned'
        field['evidence'] = classification
(scratch / 'physical-provenance.json').write_text(json.dumps(headers, indent=2))
(scratch / 'source-mappings.json').write_text(json.dumps(mappings, indent=2))
summary = Counter((r['game'], r['format'], r['physicalHeader']['encoding'], r['physicalHeader']['major'], r['physicalHeader']['minor'], r['decoderLayout']) for r in headers if r['selected'])
print(json.dumps([{'game': key[0], 'format': key[1], 'encoding': key[2], 'major': key[3], 'minor': key[4], 'decoderLayout': key[5], 'files': count} for key, count in summary.items()], indent=2))
