#!/usr/bin/env python3
"""Read-only game census. No archive member is extracted or executed.
Run: python3 tools/research/native-data-census.py --games /path/ludotheque/games
     --fixtures /path/fixtures/legacy --output /tmp/native-data-census
Only the requested output directory is written. ZIP/SFX contents are read in memory.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import shutil
import tempfile
import zipfile
import zlib

META = {'.gam', '.brd', '.tem', '.itm', '.ene', '.anm', '.tan', '.tbm', '.bkg', '.spc', '.ste', '.gph', '.fnt', '.tst', '.iso'}
MEDIA = {'.png', '.jpg', '.jpeg', '.bmp', '.gif', '.wav', '.mid', '.midi', '.mp3', '.ogg', '.avi', '.sf2', '.ttf'}
PACKAGES = {'.zip', '.exe', '.tpk', '.rar', '.7z', '.cab'}
FOLDERS = {'boards', 'chrs', 'item', 'enemy', 'misc', 'spcmove', 'statuse', 'bkrounds', 'tiles', 'bitmap', 'media', 'prg', 'main', 'font', 'plugin', 'saved'}
MAX_MEMBER = 128 * 1024 * 1024
MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_DEPTH = 8


def fold(value):
    return value.replace('\\', '/').translate(str.maketrans('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))


def logical(path):
    # A comparison key, NOT a claim that an archive's project root was discovered.
    parts = path.replace('\\', '/').split('/')
    for index, part in enumerate(parts):
        if fold(part) in FOLDERS:
            return '/'.join(parts[index:])
    return '/'.join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--downloads', type=Path, action='append', default=[], help='Known game-download directory; direct package children only')
    parser.add_argument('--package', action='append', default=[], help='Additional known game package as Collection=/path/file')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    files, containers, issues = [], [], []
    pending = tempfile.TemporaryFile(mode='w+', encoding='utf-8')
    seen = {}
    collections = []

    def accept(game, origin, name, data):
        suffix = Path(name).suffix.lower()
        digest = hashlib.sha256(data).hexdigest()
        key = (game, fold(logical(name)), digest)
        if key in seen:
            files[seen[key]]['origins'].append(origin)
            return
        ident = f'{game}/{logical(name)}@{digest[:12]}'
        row = {'id': ident, 'game': game, 'path': logical(name), 'extension': suffix,
               'bytes': len(data), 'sha256': digest, 'origins': [origin]}
        seen[key] = len(files)
        files.append(row)
        if suffix in META or suffix == '.prg':
            pending.write(json.dumps({'id': ident, 'game': game, 'path': logical(name),
                                      'base64': base64.b64encode(data).decode('ascii')}) + '\n')
        elif suffix in MEDIA:
            row['inspection'] = 'media-payload-inventoried-not-decoded'
        else:
            row['inspection'] = 'non-domain-or-unsupported-file'

    def archive(game, origin, data, depth):
        try:
            stream = io.BytesIO(data)
            if not zipfile.is_zipfile(stream):
                containers.append({'game': game, 'origin': origin, 'status': 'not-readable-as-zip', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
                return
            with zipfile.ZipFile(stream) as z:
                members = sorted((m for m in z.infolist() if not m.is_dir()), key=lambda m: m.filename)
                containers.append({'game': game, 'origin': origin, 'status': 'zip-read', 'members': len(members), 'sha256': hashlib.sha256(data).hexdigest()})
                if depth > MAX_DEPTH or sum(m.file_size for m in members) > MAX_ARCHIVE:
                    issues.append({'origin': origin, 'reason': 'archive depth/expanded-byte safety bound'})
                    return
                for m in members:
                    member_origin = origin + '!' + m.filename
                    if m.file_size > MAX_MEMBER or m.flag_bits & 1:
                        issues.append({'origin': member_origin, 'reason': 'oversize or encrypted member'})
                        continue
                    try:
                        content = z.read(m)
                        accept(game, member_origin, m.filename, content)
                        if Path(m.filename).suffix.lower() in PACKAGES:
                            archive(game, member_origin, content, depth + 1)
                    except (RuntimeError, OSError, zipfile.BadZipFile, NotImplementedError) as error:
                        recovered = False
                        # Some old installers disagree only about path separators
                        # between ZIP headers. Read via libarchive, never execute
                        # or rewrite them, and require the recorded size and CRC.
                        if str(error).startswith('File name in directory') and shutil.which('bsdtar'):
                            fallback = subprocess.run(['bsdtar', '-xOf', '-', '--', m.filename], input=data, capture_output=True, timeout=30)
                            content = fallback.stdout
                            if fallback.returncode == 0 and len(content) == m.file_size and zlib.crc32(content) == m.CRC:
                                accept(game, member_origin, m.filename, content)
                                recovered = True
                                if Path(m.filename).suffix.lower() in PACKAGES:
                                    archive(game, member_origin, content, depth + 1)
                        issues.append({'origin': member_origin, 'reason': str(error), 'recoveredWithVerifiedSizeAndCrc': recovered})
        except (OSError, zipfile.BadZipFile) as error:
            issues.append({'origin': origin, 'reason': str(error)})

    # Every local recovered collection, plus both shipped demo baselines. Six other
    # fetched fixtures are scanned too and deduplicated against Ludotheque copies.
    for label, root in [('ludotheque', args.games), ('fixtures', args.fixtures)]:
        for directory in sorted(p for p in root.iterdir() if p.is_dir()):
            game = directory.name
            collections.append({'game': game, 'source': label, 'root': f'{label}/{game}'})
            for path in sorted(directory.rglob('*')):
                if not path.is_file() or path.is_symlink():
                    continue
                relative = path.relative_to(directory).as_posix()
                origin = f'{label}/{game}/{relative}'
                if path.stat().st_size > MAX_MEMBER:
                    issues.append({'origin': origin, 'reason': 'oversize file'})
                    continue
                data = path.read_bytes()
                accept(game, origin, relative, data)
                if path.suffix.lower() in PACKAGES:
                    archive(game, origin, data, 0)
    known_packages = {c['sha256']: c['game'] for c in containers}
    extras = []
    for number, directory in enumerate(args.downloads, 1):
        for path in sorted(directory.iterdir()):
            if path.is_file() and path.suffix.lower() in PACKAGES:
                extras.append((None, f'downloads-{number}/{path.name}', path))
    for item in args.package:
        game, filename = item.split('=', 1)
        path = Path(filename)
        extras.append((game, f'extra/{game}/{path.name}', path))
    for game, origin, path in extras:
        if path.stat().st_size > MAX_MEMBER:
            issues.append({'origin': origin, 'reason': 'oversize additional package'})
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        game = game or known_packages.get(digest) or 'Archive-' + path.stem
        known_packages[digest] = game
        collections.append({'game': game, 'source': origin.split('/')[0], 'root': origin})
        accept(game, origin, path.name, data)
        archive(game, origin, data, 0)
    decoder = Path(__file__).with_name('native-data-decode.mjs')
    with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as request:
        request.write(json.dumps({'inventory': [{'id': f['id'], 'game': f['game'], 'path': f['path']} for f in files]}) + '\n')
        pending.seek(0)
        shutil.copyfileobj(pending, request)
        pending.close()
        request.seek(0)
        result = subprocess.run(['node', str(decoder)], stdin=request, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(result.stderr)
    decoded = json.loads(result.stdout)
    # Sorting ensures byte-stable reports for the same input snapshot.
    report = {'schema': 1, 'method': 'read-only static metadata census; not gameplay or a migration',
              'deduplication': 'same collection + ASCII-folded path from first type folder + SHA-256; origins retained; different bytes retained',
              'limits': {'maxMemberBytes': MAX_MEMBER, 'maxArchiveBytes': MAX_ARCHIVE, 'maxDepth': MAX_DEPTH},
              'collections': collections, 'containers': containers, 'collectionIssues': issues,
              'files': sorted(files, key=lambda x: x['id']), **decoded}
    (args.output / 'census.json').write_text(json.dumps(report, indent=2, ensure_ascii=True) + '\n')
    record_by_id = {record['id']: record for record in decoded['records']}
    tables = {
        'assets': [{**f, 'decode': record_by_id.get(f['id'])} for f in report['files']],
        'fields': decoded['fields'],
        'relationships': decoded['relationships'],
        'scripts': decoded['scripts'],
    }
    for name, rows in tables.items():
        (args.output / f'{name}.jsonl').write_text(''.join(json.dumps(row, separators=(',', ':'), ensure_ascii=True) + '\n' for row in rows))
    summary = {key: report[key] for key in ['schema', 'method', 'deduplication', 'limits', 'collections', 'containers', 'collectionIssues', 'summary']}
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'collections': len({r['game'] for r in collections}), 'files': len(files),
                      'containers': len(containers), 'collectionIssues': len(issues), **decoded['summary']}, indent=2))


if __name__ == '__main__':
    main()
