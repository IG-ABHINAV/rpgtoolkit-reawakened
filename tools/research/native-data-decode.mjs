// Read-only research host. Semantics: docs/spec/formats/* and
// docs/spec/formats/rpgcode-program.md#text-form. This is NOT a new parser,
// importer, runtime reachability analysis, or approved native format.
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { CORE_DECODERS } from '@tk-reawakened/core';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const extensions = new Map(Object.entries(CORE_DECODERS).flatMap(([id, d]) => d.extensions.map(e => [e, id])));
const records = [], fields = new Map(), edges = new Map(), scripts = [];
const sha = s => createHash('sha256').update(s).digest('hex');
const fold = s => s.replaceAll('\\', '/').replace(/[A-Z]/g, c => c.toLowerCase());
const norm = s => s.replace(/\[\d+\]/g, '[]');
const paths = new Map();
const folder = {gam:'Main',board:'Boards',character:'Chrs',item:'Item',enemy:'Enemy',animation:'Misc',tile:'Tiles',image:'Bitmap',audio:'Media',program:'Prg',skill:'SpcMove',status:'StatusE',background:'Bkrounds',plugin:'Plugin','editor-language':'Resources'};
const rules = {
  gam: {languageFile:'editor-language',startupPrg:'program',runTimePrg:'program',customFightPrg:'program',gameOverPrg:'program','extKeys[].program':'program',initBoard:'board',initChar:'character','enemies[].enemyFile':'enemy',menuPlugin:'plugin',fightPlugin:'plugin','plugins[].pluginFile':'plugin',skinButton:'image',skinWindow:'image',mouseCursor:'visual',cursorMoveSound:'audio',cursorSelectSound:'audio',cursorCancelSound:'audio','audioSettings.defaultSoundFont':'audio'},
  board: {'lut[]':'tile','programs[].program':'program','programs[].graphic':'visual','sprites[].itemFile':'actor','sprites[].activationPrg':'program','sprites[].multitaskPrg':'program','images[].file':'image','threads[]':'program','links.north':'edge','links.south':'edge','links.east':'edge','links.west':'edge','properties.backgroundImage':'image','properties.backgroundMusic':'audio','properties.enterPrg':'program','properties.battleBackground':'background'},
  character: {profilePicture:'visual','specialMoves[].file':'skill',levelUpProgram:'program','battleSounds[]':'audio','movementAnimations[]':'animation','battleStances[]':'animation','idleAnimations[]':'animation','customStances[].animation':'animation','legacyGraphics.walkFrames[].top':'tile','legacyGraphics.walkFrames[].bottom':'tile','legacyGraphics.battleTiles[]':'tile','legacyGraphics.restTiles[]':'tile','legacyGraphics.customFrames[].top':'tile','legacyGraphics.customFrames[].bottom':'tile'},
  item: {onEquipProgram:'program',onRemoveProgram:'program',menuUseProgram:'program',battleUseProgram:'program',multitaskProgram:'program',activationProgram:'program',battleAnimation:'animation','movementAnimations[]':'animation',restAnimation:'animation',reservedAnimation:'animation','idleAnimations[]':'animation','customStances[].animation':'animation','legacyWalk.frames[].top':'tile','legacyWalk.frames[].bottom':'tile','legacyWalk.restTiles[]':'tile','allowedCharacters[]':'character-handle'},
  enemy: {'specialMoves[]':'skill','weaknesses[]':'skill','strengths[]':'skill',aiProgram:'program',defeatProgram:'program',runAwayProgram:'program','stances[]':'animation','customStances[].animation':'animation','tileGrid[]':'tile'},
  animation: {'frames[].image':'visual','frames[].sound':'audio'},
  'special-move': {program:'program',statusEffect:'status',animation:'animation'},
  'status-effect': {program:'program'},
  'battle-background': {image:'image',music:'audio',menuMoveSound:'audio',menuChooseSound:'audio',readySound:'audio',cantDoSound:'audio','tiles[]':'tile'},
  'tile-animation': {'frames[]':'tile'},
  'tile-bitmap': {'cells[].tile':'tile'},
};

function reference(f, field, text, kind, evidence = 'declared-field') {
  if (!text || text === 'TK DEFAULT') return;
  let target = text, category = kind;
  if (kind === 'edge') category = /\.brd$/i.test(text) ? 'board' : 'program';
  if (kind === 'actor') category = /\.tem$/i.test(text) ? 'character' : 'item';
  if (kind === 'visual') category = /\.(?:tst|iso)\d+$|\.(?:gph|tan)$/i.test(text) ? 'tile' : 'image';
  if (category === 'tile') target = text.replace(/(\.(?:tst|iso))\d+$/i, '$1');
  let candidates = [];
  const prefix = folder[category];
  if (prefix) {
    const normal = fold(target);
    const expected = normal.startsWith(fold(prefix) + '/') ? normal : fold(prefix) + '/' + normal;
    // Conservative collection-local candidates. No basename-only guessing and
    // no claim that a match is reachable or selected by a particular main file.
    candidates = paths.get(`${f.game}|${expected}`) ?? [];
  }
  let status = category.endsWith('-handle') ? 'semantic-handle-not-file' : candidates.length === 1 ? 'unique-path-candidate' : candidates.length > 1 ? 'ambiguous-path-candidates' : 'no-path-candidate';
  const inline = category === 'program' && candidates.length === 0
    && !/\.(?:prg|rnc)$/i.test(text.trim()) && /[();{}\n]|^\s*#/.test(text);
  if (inline) status = 'inline-code-candidate';
  const value = inline ? `sha256:${sha(text)}` : text;
  const key = JSON.stringify([f.id, norm(field), value, kind, evidence]);
  let edge = edges.get(key);
  if (!edge) {
    edge = {source:f.id,game:f.game,field:norm(field),kind,evidence,value,status,candidates,occurrences:0};
    if (inline) edge.sourceLength = text.length;
    edges.set(key,edge);
    if (inline) inspectScript(f,field,text,'embedded-candidate');
  }
  edge.occurrences++;
}

function inspectScript(f, field, text, sourceKind) {
  // Screening only: recognises documented comment forms and quoted strings,
  // then counts call-shaped words. Does not establish dialect validity, call
  // resolution, control flow, dynamic filenames, or runtime execution.
  const literals=[];
  const cleaned = text.replace(/^[\t ]*\*(?!\*)[^\r\n]*|"[^"\r\n]*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\*\*[^\r\n]*/gm, token => {
    if (token.startsWith('"')) {literals.push(token.slice(1,-1));return ' STRING ';}
    return ' ';
  });
  const calls={};
  for (const match of cleaned.matchAll(/\b([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)) {
    const name=match[1].toLowerCase(); calls[name]=(calls[name]??0)+1;
  }
  scripts.push({source:f.id,field,sourceKind,bytes:Buffer.byteLength(text),lines:text.split(/\r\n|\r|\n/).length,sha256:sha(text),normalisedSha256:sha(cleaned.replace(/\s+/g,' ').trim()),callCandidates:calls});
  const extKinds={gam:'gam',brd:'board',tem:'character',itm:'item',ene:'enemy',anm:'animation',spc:'skill',ste:'status',bkg:'background',prg:'program',png:'image',jpg:'image',jpeg:'image',bmp:'image',gif:'image',tbm:'image',wav:'audio',mid:'audio',midi:'audio',mp3:'audio',ogg:'audio',tst:'tile',iso:'tile',gph:'tile',tan:'tile'};
  for (const literal of literals) {
    const match=/\.([A-Za-z]+)(\d*)$/.exec(literal);
    if (match && extKinds[match[1].toLowerCase()]) reference(f,field,literal,extKinds[match[1].toLowerCase()],'script-literal-candidate');
  }
}

function inspectModel(f, kind, model) {
  const present = new Set(), defined = new Set();
  function visit(value,path) {
    if (!path) {for(const [k,v] of Object.entries(value)) visit(v,k); return;}
    const field=norm(path), key=`${kind}|${field}`;
    let row=fields.get(key);
    if(!row){row={format:kind,field,files:0,definedFiles:0,occurrences:0,types:{},games:{},empty:0,zero:0,lengthMin:null,lengthMax:null,numberMin:null,numberMax:null,examples:[]};fields.set(key,row);}
    present.add(key); if(value!==undefined)defined.add(key); row.occurrences++;
    const type=value===null?'null':value===undefined?'undefined':ArrayBuffer.isView(value)?value.constructor.name:Array.isArray(value)?'array':typeof value;
    row.types[type]=(row.types[type]??0)+1;
    if(value===''||(Array.isArray(value)&&value.length===0))row.empty++;
    if(value===0)row.zero++;
    if(typeof value==='number'&&Number.isFinite(value)){row.numberMin=row.numberMin===null?value:Math.min(row.numberMin,value);row.numberMax=row.numberMax===null?value:Math.max(row.numberMax,value);}
    if(typeof value==='string'||Array.isArray(value)||ArrayBuffer.isView(value)){const n=value.length;row.lengthMin=row.lengthMin===null?n:Math.min(row.lengthMin,n);row.lengthMax=row.lengthMax===null?n:Math.max(row.lengthMax,n);}
    if(row.examples.length<3&&!row.examples.includes(f.id))row.examples.push(f.id);
    if(typeof value==='string') {const ref=rules[kind]?.[field];if(ref)reference(f,path,value,ref);return;}
    if(ArrayBuffer.isView(value)||value===null||typeof value!=='object')return;
    if(Array.isArray(value)) {
      // Numerical matrices/pixel arrays have homogeneous scalar fields. Record
      // every value statistically without allocating one object per cell.
      for(const v of value) visit(v,`${path}[]`);
    } else for(const [k,v] of Object.entries(value))visit(v,`${path}.${k}`);
  }
  visit(model,'');
  for(const key of present){const row=fields.get(key);row.files++;row.games[f.game]=(row.games[f.game]??0)+1;}
  for(const key of defined)fields.get(key).definedFiles++;
}

let inventoryLoaded = false;
for await (const line of lines) {
  const f = JSON.parse(line);
  if (!inventoryLoaded) {
    for (const asset of f.inventory) {
      const key = `${asset.game}|${fold(asset.path)}`;
      const list = paths.get(key) ?? [];
      list.push(asset.id); paths.set(key, list);
    }
    inventoryLoaded = true;
    continue;
  }
  const bytes=Buffer.from(f.base64,'base64');
  const ext=f.path.split('.').at(-1).toLowerCase();
  if(ext==='prg') {
    if(bytes[0]===0){records.push({id:f.id,format:'program',status:'compiled-program-not-inspected'});continue;}
    inspectScript(f,'source',new TextDecoder('windows-1252').decode(bytes),'file');
    records.push({id:f.id,format:'program',status:'source-screened-not-executed'});continue;
  }
  const kind=extensions.get(ext);
  if(!kind){records.push({id:f.id,status:'no-decoder'});continue;}
  if(bytes.length===0){records.push({id:f.id,format:kind,status:'zero-byte-placeholder-no-authored-fields'});continue;}
  let result;
  try {result=CORE_DECODERS[kind].decode(bytes,{});} catch(error){records.push({id:f.id,format:kind,status:'decoder-threw',message:String(error)});continue;}
  if(!result.ok){records.push({id:f.id,format:kind,status:'decode-failed',error:result.error});continue;}
  const model=kind==='board'?result.value.board:result.value;
  records.push({id:f.id,format:kind,status:'decoded',major:model.major??null,minor:model.minor??null,warnings:result.warnings});
  inspectModel(f,kind,model);
}
const statuses={},formats={};
for(const r of records){statuses[r.status]=(statuses[r.status]??0)+1;if(r.status==='decoded')formats[r.format]=(formats[r.format]??0)+1;}
const edgeStatuses={};for(const e of edges.values())edgeStatuses[e.status]=(edgeStatuses[e.status]??0)+1;
console.log(JSON.stringify({summary:{records:records.length,statuses,formats,fieldPaths:fields.size,relationshipRows:edges.size,edgeStatuses,scripts:scripts.length},records,fields:[...fields.values()].sort((a,b)=>`${a.format}|${a.field}`.localeCompare(`${b.format}|${b.field}`,'en')),relationships:[...edges.values()],scripts}));
