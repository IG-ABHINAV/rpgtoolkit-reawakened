"""Exercise official composition/evaluation tools; all inputs local and inspectable.
Usage: python3 composition.py SCRATCH_DIRECTORY
Tools are pinned standalone downloads described in the report; no legacy code runs.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

scratch = Path(sys.argv[1])
binpath = scratch / 'bin'
folder = scratch / 'composition'
folder.mkdir(exist_ok=True)
tools = Path(__file__).parent
java = '/opt/homebrew/opt/openjdk/bin/java'
environment = {**os.environ, 'DYLD_LIBRARY_PATH': '/usr/lib', 'XDG_CACHE_HOME': str(scratch / 'cache')}
files = {
    'defaults.conf': 'base { name = "Frap", hp = 100, speed = 2 }\n',
    'actor.conf': 'include "defaults.conf"\nactor = ${base}\nactor.hp = 120\n',
    'override.conf': 'include "actor.conf"\nactor.hp = 140\n',
    'bad.conf': 'include "actor.conf"\nactor.hp = "invalid"\n',
    'environment.conf': 'actor { hp = 100, name = "Frap", name = ${?TKR_RESEARCH_NAME} }\n',
    'defaults.cue': 'package research\n#Actor: {name: string, hp: int & >=0, speed: int & >=0}\nbase: {name: "Frap", hp: 100, speed: 2}\n',
    'actor.cue': 'package research\nactor: #Actor & {name: base.name, hp: base.hp + 20, speed: base.speed}\n',
    'override.cue': 'package research\nactor: hp: 140\n',
    'bad.cue': 'package research\nactor: hp: "invalid"\n',
    'editable.cue': 'package research\nactor: #Actor & {name: base.name, hp: *120 | int, speed: base.speed}\n',
    'defaults.dhall': '{ name = "Frap", hp = 100, speed = 2 }\n',
    'actor.dhall': 'let base = ./defaults.dhall\nlet Actor = { name : Text, hp : Natural, speed : Natural }\nin (base // { hp = base.hp + 20 }) : Actor\n',
    'override.dhall': 'let actor = ./actor.dhall\nin actor // { hp = 140 }\n',
    'bad.dhall': 'let actor = ./actor.dhall\nin (actor // { hp = "invalid" }) : { name : Text, hp : Natural, speed : Natural }\n',
    'defaults.ncl': '{ name = "Frap", hp = 100, speed = 2 }\n',
    'actor.ncl': 'let base = import "defaults.ncl" in\nbase & { hp | Number | force = base.hp + 20, speed | Number }\n',
    'override.ncl': 'let actor = import "actor.ncl" in\nactor & { hp | priority 100 = 140 }\n',
    'bad.ncl': 'let actor = import "actor.ncl" in\nactor & { hp | priority 100 = "invalid" }\n',
    'conflict.ncl': '{ hp = 100 } & { hp = 120 }\n',
    'editable.ncl': 'let base = import "defaults.ncl" in\nbase & { hp | Number | priority 1 = base.hp + 20, speed | Number }\n',
    'editable-override.ncl': 'let actor = import "editable.ncl" in\nactor & { hp | priority 100 = 140 }\n',
    'editable-bad.ncl': 'let actor = import "editable.ncl" in\nactor & { hp | priority 100 = "invalid" }\n',
    'defaults.pkl': 'name: String = "Frap"\nhp: Int(isBetween(0, 10000)) = 100\nspeed: Int = 2\n',
    'actor.pkl': 'amends "defaults.pkl"\nhp = super.hp + 20\n',
    'override.pkl': 'amends "actor.pkl"\nhp = 140\n',
    'bad.pkl': 'amends "actor.pkl"\nhp = "invalid"\n',
}
for name, content in files.items():
    (folder / name).write_text(content)


def execute(args, extra_env=None):
    start = time.perf_counter()
    try:
        result = subprocess.run(args, cwd=folder, env={**environment, **(extra_env or {})}, text=True, capture_output=True, timeout=60)
        return {'command': args, 'status': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'elapsedMs': (time.perf_counter() - start) * 1000}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'command': args, 'error': str(error)}


hocon = [java, '-cp', str(scratch / 'config-1.4.10.jar'), str(tools / 'HoconProbe.java')]
results = {
    'HOCON': {
        'version': execute([java, '--version']),
        'evaluate': execute(hocon + ['actor.conf']), 'editOverride': execute(hocon + ['override.conf']),
        'invalid': execute(hocon + ['bad.conf']),
        'environmentDisabled': execute(hocon + ['environment.conf'], {'TKR_RESEARCH_NAME': 'must-not-leak'}),
        'writePolicy': 'write actor.hp to override.conf; changing defaults.conf intentionally affects all inheritors; substitutions do not support arithmetic',
    },
    'CUE': {
        'version': execute([str(binpath / 'cue'), 'version']),
        'evaluate': execute([str(binpath / 'cue'), 'export', 'defaults.cue', 'actor.cue', '-e', 'actor']),
        'editComputedConflict': execute([str(binpath / 'cue'), 'export', 'defaults.cue', 'actor.cue', 'override.cue', '-e', 'actor']),
        'editDefaultOverride': execute([str(binpath / 'cue'), 'export', 'defaults.cue', 'editable.cue', 'override.cue', '-e', 'actor']),
        'invalid': execute([str(binpath / 'cue'), 'export', 'defaults.cue', 'actor.cue', 'bad.cue', '-e', 'actor']),
        'writePolicy': 'computed constraints cannot be overridden; edit expression at actor.cue or design an explicit default alternative; unification is not Git conflict resolution',
    },
    'Dhall': {
        'version': execute([str(binpath / 'dhall'), '--version']),
        'evaluate': execute([str(binpath / 'dhall-to-json'), '--file', 'actor.dhall']),
        'editOverride': execute([str(binpath / 'dhall-to-json'), '--file', 'override.dhall']),
        'invalid': execute([str(binpath / 'dhall-to-json'), '--file', 'bad.dhall']),
        'writePolicy': 'write an explicit record override in override.dhall; normalization produces values but not original comments/import provenance',
    },
    'Nickel': {
        'version': execute([str(binpath / 'nickel'), '--version']),
        'evaluate': execute([str(binpath / 'nickel'), 'export', 'actor.ncl']),
        'editOverride': execute([str(binpath / 'nickel'), 'export', 'override.ncl']),
        'invalid': execute([str(binpath / 'nickel'), 'export', 'bad.ncl']),
        'conflict': execute([str(binpath / 'nickel'), 'export', 'conflict.ncl']),
        'writePolicy': 'priority cannot automatically choose a creator-intended owner; force has stronger priority than ordinary numeric priorities; keep source expression or introduce an explicit edit field',
    },
    'Pkl': {
        'version': execute([str(binpath / 'pkl'), '--version']),
        'evaluate': execute([str(binpath / 'pkl'), 'eval', '-f', 'json', 'actor.pkl']),
        'editOverride': execute([str(binpath / 'pkl'), 'eval', '-f', 'json', 'override.pkl']),
        'invalid': execute([str(binpath / 'pkl'), 'eval', '-f', 'json', 'bad.pkl']),
        'writePolicy': 'write amendment override.pkl; super.hp remains provenance in actor.pkl rather than an editable exported literal',
    },
}
results['Nickel']['editExplicitPriority'] = execute([str(binpath / 'nickel'), 'export', 'editable-override.ncl'])
results['Nickel']['invalidUnshadowed'] = execute([str(binpath / 'nickel'), 'export', 'editable-bad.ncl'])
(scratch / 'composition-results.json').write_text(json.dumps(results, indent=2))
print(json.dumps({name: {k: {'status': v.get('status'), 'stdout': v.get('stdout', '')[:300], 'stderr': v.get('stderr', '')[:500]} for k, v in group.items() if isinstance(v, dict)} for name, group in results.items()}, indent=2))
