"""Read pinned corpus bytes without executing programs or extracting installers.
Usage: python3 collect.py SHARED_INPUTS_JSON SCRATCH_DIRECTORY
Only scratch receives payloads. Archive member names are never filesystem paths.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

inventory = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
records = {row['id']: row for row in inventory['records']}
archives = {}


def source_bytes(asset):
    failures = []
    for origin in asset['origins']:
        parts = re.split(r'(?i)(?<=\.zip)!', origin)
        if parts[0].startswith('ludotheque/'):
            path = Path('/Users/jensen/projects/ludotheque/games') / parts[0][11:]
        elif parts[0].startswith('fixtures/demo/'):
            path = Path(inventory['roots']['demo']) / parts[0][14:]
        else:
            continue
        try:
            if len(parts) == 1:
                return path.read_bytes(), origin
            key = str(path)
            if key not in archives:
                archives[key] = zipfile.ZipFile(path)
            archive = archives[key]
            for index, member in enumerate(parts[1:]):
                payload = archive.read(member)
                if index < len(parts) - 2:
                    key += '!' + member
                    if key not in archives:
                        archives[key] = zipfile.ZipFile(io.BytesIO(payload))
                    archive = archives[key]
            return payload, origin
        except (OSError, KeyError, zipfile.BadZipFile) as error:
            failures.append(str(error))
    raise ValueError((asset['id'], failures))


count = 0
with (out / 'payloads.jsonl').open('w') as sink:
    for asset in inventory['files']:
        record = records.get(asset['id'])
        if not record or record.get('format') in ('tileset', 'font'):
            continue
        payload, origin = source_bytes(asset)
        digest = hashlib.sha256(payload).hexdigest()
        if digest != asset['sha256']:
            raise ValueError(f"hash mismatch: {asset['id']}")
        import base64
        sink.write(json.dumps({**asset, 'originUsed': origin, 'prior': record,
                               'base64': base64.b64encode(payload).decode()}) + '\n')
        count += 1
print(json.dumps({'verifiedPayloads': count, 'output': str(out / 'payloads.jsonl')}))
