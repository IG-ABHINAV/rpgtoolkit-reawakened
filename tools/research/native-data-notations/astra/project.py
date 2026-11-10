"""Project decoded corpus into independent research contracts, never production conversion.
Usage: python3 project.py SCRATCH_DIRECTORY
Every consumed decoded top-level field is mapped; the remainder stays in a local
compatibility ledger. Defaults are decoder observations, not claims about stored bytes.
"""
import hashlib
import json
from pathlib import Path
import sys

scratch = Path(sys.argv[1])
rows = [json.loads(line) for line in (scratch / 'decoded.jsonl').read_text().splitlines()]
valid = [r for r in rows if r['result']['ok']]
index = {(r['game'], r['path'].replace('\\', '/').lower()): r for r in valid}
plan = {
    'demo': ['Boards/start.brd', 'Boards/out.brd', 'Item/man.itm', 'Chrs/start.tem', 'Misc/start/start_s.anm', 'Prg/man_wander.prg'],
    'ChimeranEmpire': ['Boards/Museum.brd', 'Boards/Trogan 1.brd', 'Item/Apple.itm', 'Item/Crystal Staff.itm', 'Chrs/Flane.tem', 'Misc/Bolt 1.anm', 'SpcMove/Bolt 1.spc', 'Prg/Give Apple.prg', 'Prg/Inn 3.prg'],
    'Caoquest': ['Boards/house3.brd', 'Boards/town.brd', 'Item/10smp.itm', 'Chrs/cao.tem', 'Chrs/start.tem', 'Misc/combo.anm', 'SpcMove/Earth.spc'],
    'CrystalImmortality': ['Boards/Castle3left.brd', 'Boards/city1.brd', 'Item/HP gain.itm', 'Chrs/Dupcyk.tem', 'Misc/bolt1.anm', 'SpcMove/Magus.spc', 'Prg/bar fight C.prg', 'Prg/mymenu.prg'],
}
mappings = []
summary = {}


def slug(text):
    return ''.join(c.lower() if c.isalnum() else '-' for c in text).strip('-')


def model(row):
    value = row['result']['value']
    return value.get('board', value)


def stable(row, family):
    return family + ':' + row['path'].replace('\\', '/').lower()


for game, paths in plan.items():
    dest = scratch / 'projects' / game
    dest.mkdir(parents=True, exist_ok=True)
    selected = {}
    for path in paths:
        row = index.get((game, path.lower()))
        if row is None:
            raise ValueError(('missing selected source', game, path))
        selected[row['id']] = row
    for row in valid:
        if row['game'] == game and row['prior']['format'] == 'gam':
            selected[row['id']] = row
    # Include declared scene actors and programs, not guessed script-literal dependencies.
    for row in list(selected.values()):
        if row['prior']['format'] == 'board':
            m = model(row)
            refs = [('Item/' + s['itemFile']) for s in m['sprites'] if s['itemFile']]
            refs += ['Prg/' + s[k] for s in m['sprites'] for k in ('activationPrg', 'multitaskPrg') if s[k]]
            refs += ['Prg/' + p['program'] for p in m['programs'] if p['program']]
            for ref in refs:
                target = index.get((game, ref.replace('\\', '/').lower()))
                if target:
                    selected[target['id']] = target
    documents = []
    provenance = []
    def ref(path, family, folder):
        if not path:
            return None
        normalized = (folder + '/' + path).replace('\\', '/').lower()
        return family + ':' + normalized
    def binding(text):
        if not text:
            return {'mode': 'none', 'source': None, 'program': None, 'context': 'legacy-owner-context'}
        target = index.get((game, ('Prg/' + text).replace('\\', '/').lower()))
        if target or text.lower().endswith(('.prg', '.rnc')):
            return {'mode': 'file', 'source': None, 'program': ref(text, 'program', 'Prg'), 'context': 'legacy-owner-context'}
        return {'mode': 'inline', 'source': text.replace('\r\n', '\n').replace('\r', '\n'), 'program': None, 'context': 'legacy-owner-context'}
    for row in selected.values():
        m = model(row)
        family = row['prior']['format']
        consumed = {}
        produced = []
        def take(key, target):
            consumed[key] = target
            return m.get(key)
        def emit(kind, content):
            doc = {'id': stable(row, kind), 'kind': kind, **content}
            documents.append(doc)
            produced.append(doc['id'])
            return doc
        if family == 'board':
            width = take('sizeX', 'scene.width')
            height = take('sizeY', 'scene.height')
            layers = take('sizeL', 'scene.layers')
            coord = take('coordType', 'scene.coordinateType')
            effective_width = width + height if coord & 2 else width
            effective_height = effective_width if coord & 2 else height
            matrix = take('tileMatrix', 'scene.tileRows[*].cells')
            tile_rows = [{'id': f'layer-{layer + 1}-row-{y + 1}', 'layer': layer + 1, 'y': y + 1,
                          'cells': matrix[(layer * effective_height + y) * effective_width:(layer * effective_height + y + 1) * effective_width]}
                         for layer in range(layers) for y in range(effective_height)]
            sprites = take('sprites', 'scene.placements; empty slots in compatibility source')
            placements = []
            for i, sprite in enumerate(sprites):
                if sprite['itemFile']:
                    placements.append({'id': 'placement-' + str(i), 'actor': ref(sprite['itemFile'], 'actor', 'Item'),
                                       'x': sprite['x'], 'y': sprite['y'], 'layer': sprite['layer'],
                                       'activation': binding(sprite['activationPrg']), 'thread': binding(sprite['multitaskPrg']),
                                       'conditions': {k: v for k, v in sprite.items() if k not in ('itemFile', 'x', 'y', 'layer', 'activationPrg', 'multitaskPrg')}})
            programs = take('programs', 'scene.triggers; empty slots in compatibility source')
            triggers = [{'id': 'trigger-' + str(i), 'binding': binding(p['program']),
                         'regionAndConditions': {k: v for k, v in p.items() if k != 'program'}}
                        for i, p in enumerate(programs) if p['program']]
            emit('scene', {'width': width, 'height': height, 'layers': layers, 'coordinateType': coord,
                           'tilePalette': take('lut', 'scene.tilePalette'), 'tileRows': tile_rows,
                           'geometry': take('vectors', 'scene.geometry'), 'placements': placements,
                           'triggers': triggers, 'environment': take('properties', 'scene.environment'),
                           'links': take('links', 'scene.links'), 'images': take('images', 'scene.images')})
        elif family in ('item', 'character'):
            name = take('name', 'actor.name; party-member.name or inventory.name when applicable')
            inventory_capability = family == 'item' and any(m.get(k) for k in ('equipable', 'menuUsable', 'battleUsable', 'keyItem', 'buyPrice', 'sellPrice'))
            presentation = {}
            for key in ('movementAnimations', 'idleAnimations', 'battleStances', 'restAnimation', 'profilePicture', 'customStances', 'legacyGraphics', 'legacyWalk', 'battleSounds'):
                if key in m:
                    presentation[key] = take(key, 'presentation.' + key)
            emit('presentation', presentation)
            actor = emit('actor', {'name': name, 'presentation': stable(row, 'presentation'),
                                  'inventory': stable(row, 'inventory') if inventory_capability else None,
                                  'partyMember': stable(row, 'party-member') if family == 'character' else None,
                                  'geometry': {key: take(key, 'actor.geometry.' + key) for key in ('vectorBases', 'sizeType') if key in m},
                                  'movement': {key: take(key, 'actor.movement.' + key) for key in ('speed', 'idleTime') if key in m},
                                  'behavior': {key: binding(take(key, 'actor.behavior.' + key)) for key in ('multitaskProgram', 'activationProgram') if key in m},
                                  'extensions': {}})
            if family == 'character':
                emit('party-member', {'name': name, 'stats': take('stats', 'party-member.stats'),
                                     'legacyVariableBindings': take('variableNames', 'party-member.legacyVariableBindings'),
                                     'skills': {key: take(key, 'party-member.skills.' + key) for key in ('specialMoves', 'hasSpecialMoves', 'specialMoveCategory') if key in m},
                                     'equipment': {key: take(key, 'party-member.equipment.' + key) for key in ('accessorySlots', 'bodySlots') if key in m},
                                     'progression': {key: take(key, 'party-member.progression.' + key) for key in ('firstLevelExp', 'experienceIncrease', 'maxLevel', 'levelUpType', 'levelIncreases', 'levelUpProgram') if key in m}})
            if inventory_capability:
                inventory_fields = ('description', 'equipable', 'menuUsable', 'battleUsable', 'usedBy', 'allowedCharacters', 'buyPrice', 'sellPrice', 'keyItem', 'equipSlots', 'accessoryName', 'equipBonus', 'onEquipProgram', 'onRemoveProgram', 'menuUseHp', 'menuUseSmp', 'menuUseProgram', 'battleUseHp', 'battleUseSmp', 'battleUseProgram', 'battleAnimation')
                emit('inventory', {'name': name, **{key: take(key, 'inventory.' + key) for key in inventory_fields if key in m}})
        elif family == 'animation':
            frames = take('frames', 'clip.frames; empty physical slots in compatibility source')
            emit('clip', {'width': take('width', 'clip.width'), 'height': take('height', 'clip.height'),
                          'delaySeconds': take('delay', 'clip.delaySeconds'),
                          'frames': [{'id': 'frame-' + str(i), **frame} for i, frame in enumerate(frames) if frame['image']]})
        elif family == 'special-move':
            emit('skill', {key: take(key, 'skill.' + key) for key in m if key not in ('magic', 'major', 'minor', 'residue')})
        elif family == 'gam':
            emit('project', {'title': take('gameTitle', 'project.title'),
                             'startingScene': ref(take('initBoard', 'project.startingScene'), 'scene', 'Boards'),
                             'startingActor': ref(take('initChar', 'project.startingActor'), 'actor', 'Chrs'),
                             'startup': binding(take('startupPrg', 'project.startup')),
                             'runtime': binding(take('runTimePrg', 'project.runtime')),
                             'gameOver': binding(take('gameOverPrg', 'project.gameOver')),
                             'legacyPluginNames': {key: take(key, 'project.legacyPluginNames.' + key) for key in ('menuPlugin', 'fightPlugin', 'plugins') if key in m}})
        elif family == 'program':
            source = take('source', 'program.source')
            emit('program', {'source': source.replace('\r\n', '\n').replace('\r', '\n'), 'sourceEncoding': 'UTF-8 after Windows-1252 decode; CRLF/CR normalized to LF', 'executed': False})
        else:
            raise ValueError(('unhandled selection', family))
        provenance.append({key: row[key] for key in ('id', 'game', 'path', 'sha256', 'originUsed', 'prior')})
        field_map = [{'source': key, 'target': consumed.get(key, 'compatibility-only; no native owner proposed'),
                      'evidence': 'decoded observation; stored/default distinction requires version catalogue'} for key in m]
        mappings.append({'source': row['id'], 'sha256': row['sha256'], 'outputs': produced, 'fields': field_map})
        compat = dest / 'compatibility' / (slug(row['path']) + '.json')
        compat.parent.mkdir(exist_ok=True)
        compat.write_text(json.dumps({'source': row['id'], 'unmapped': {k: v for k, v in m.items() if k not in consumed},
                                    'originalDecodedModel': m}, ensure_ascii=False, indent=2))
    for doc in documents:
        folder = dest / doc['kind']
        folder.mkdir(exist_ok=True)
        (folder / (slug(doc['id']) + '.json')).write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    # Same bundle across notations; bundles are comparison conveniences, not one giant game database.
    bundle = {'game': game, 'documents': documents}
    (dest / 'comparison.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2))
    (dest / 'provenance.json').write_text(json.dumps(provenance, indent=2))
    summary[game] = {'sourceFiles': len(selected), 'documents': len(documents),
                     'before': [r['path'] for r in selected.values()],
                     'after': [str(p.relative_to(dest)) for p in dest.glob('*/*.json') if p.parent.name != 'compatibility'],
                     'programLines': sum(len(d['source'].splitlines()) for d in documents if d['kind'] == 'program'),
                     'scenes': [{'id': d['id'], 'dimensions': [d['width'], d['height'], d['layers']], 'placements': len(d['placements']), 'rows': len(d['tileRows'])} for d in documents if d['kind'] == 'scene']}
(scratch / 'source-mappings.json').write_text(json.dumps(mappings, indent=2))
(scratch / 'projection-summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({g: {k: v for k, v in s.items() if k not in ('before', 'after')} for g, s in summary.items()}, indent=2))
