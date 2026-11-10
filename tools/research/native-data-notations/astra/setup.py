"""Recreate the exercised macOS/arm64 research toolchain outside the repository.
Usage: python3 setup.py SCRATCH_DIRECTORY [--rust]
This does not obtain games, execute RPGCode, or run repository gates.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('scratch', type=Path)
parser.add_argument('--rust', action='store_true', help='install isolated Rust 1.93.0 and wasm target')
args = parser.parse_args()
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    parser.error('download manifest records the exercised Darwin/arm64 binaries; choose platform artifacts explicitly elsewhere')
helper = Path(__file__).resolve().parent
scratch = args.scratch.resolve()
scratch.mkdir(parents=True, exist_ok=True)
for source, target in [('dependencies.json', 'package.json'), ('npm-lock.json', 'package-lock.json')]:
    content = (helper / source).read_bytes()
    existing = scratch / target
    if existing.exists() and existing.read_bytes() != content:
        raise SystemExit(f'Refusing to replace different experiment manifest: {existing}')
    existing.write_bytes(content)
subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=scratch, check=True)
bin_dir = scratch / 'bin'
bin_dir.mkdir(exist_ok=True)
for entry in json.loads((helper / 'downloads.json').read_text()):
    if entry['name'] == 'rustup-init' and not args.rust:
        continue
    archive = scratch / entry['name']
    if not archive.exists():
        request = urllib.request.Request(entry['url'], headers={'User-Agent': 'tkr-1778-research'})
        with urllib.request.urlopen(request, timeout=120) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != entry['sha256']:
        raise SystemExit(f'Download checksum mismatch: {archive}')
    if '.tar.' in entry['name']:
        with tarfile.open(archive) as bundle:
            for member in bundle.getmembers():
                name = Path(member.name).name
                if member.isfile() and name in {'cue', 'dhall', 'dhall-to-json'}:
                    destination = bin_dir / name
                    with bundle.extractfile(member) as source:
                        destination.write_bytes(source.read())
                    destination.chmod(0o755)
    elif entry['name'] in {'nickel-arm64-macos', 'pkl-macos-aarch64'}:
        destination = bin_dir / ('nickel' if entry['name'].startswith('nickel') else 'pkl')
        destination.write_bytes(archive.read_bytes())
        destination.chmod(0o755)
if args.rust:
    env = {**os.environ, 'RUSTUP_HOME': str(scratch / 'rustup'), 'CARGO_HOME': str(scratch / 'cargo')}
    rustup = scratch / 'cargo/bin/rustup'
    if not rustup.exists():
        installer = scratch / 'rustup-init'
        installer.chmod(0o755)
        subprocess.run([str(installer), '-y', '--no-modify-path', '--profile', 'minimal', '--default-toolchain', '1.93.0'], env=env, check=True)
    subprocess.run([str(rustup), 'target', 'add', '--toolchain', '1.93.0', 'wasm32-unknown-unknown'], env=env, check=True)
print('Dependencies and evaluator binaries ready; see reproduction commands for bridge compilation and experiments.')
