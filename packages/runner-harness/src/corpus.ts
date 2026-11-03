/**
 * Headless script corpus: the nine synthetic programs required by discovery
 * (discovery/language-readiness.md:257-268), the legacy sample programs (start.prg and
 * system.prg), the synthetic TK2 dialect program, catalogue completeness assertions,
 * and random-step snapshot restore verification.
 */

import {
  assetKey,
  createAssetIndex,
  createGameState,
  createScriptServices,
  fileProgramRef,
  PACKAGE_ROOT,
  utf8Encode,
  CORE_PLUGIN,
  BATTLE_PLUGIN,
  MEDIA_PLUGIN,
  CATALOGUE_PLUGIN,
  WORLD_PLUGIN,
  type AssetKey,
  type InputRecord,
  type ProgramLoader,
} from "@tk-reawakened/core";
import { TK2_COMPAT_PLUGIN } from "@tk-reawakened/plugin-tk2-compat";
import { PLATFORM_FIXTURE_SOURCES } from "./platform-fixtures.ts";
import { checkSnapshotRestore, randomSplit } from "./restore-check.ts";
import {
  createScriptHost,
  restoreScriptHost,
  type PackageStartupRef,
  type ScriptHost,
  type ScriptHostBlobs,
} from "./script-host.ts";
export type CorpusSessionContext = {
  readonly blobs?: ScriptHostBlobs;
};

export type CorpusProgram = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ticks: number;
  readonly createHost: (seed: number, context?: CorpusSessionContext) => ScriptHost;
  readonly restoreHost: (json: string, context?: CorpusSessionContext) => ScriptHost;
  readonly inputsForTick?: (tick: number) => readonly InputRecord[];
};

export type ProgramResult = {
  readonly id: string;
  readonly ticks: number;
  readonly stateHash: string;
};

export type ScriptsGolden = {
  readonly schema: 1;
  readonly programs: readonly { readonly id: string; readonly hash: string }[];
};

export function createMemoryLoader(files: Record<string, string | Uint8Array>): ProgramLoader {
  const paths = Object.keys(files).map((name) => `Prg/${name}`);
  const bytes = new Map<AssetKey, Uint8Array>();
  for (const [name, content] of Object.entries(files)) {
    const key = assetKey(`Prg/${name}`);
    bytes.set(key, typeof content === "string" ? utf8Encode(content) : content);
  }
  return {
    index: createAssetIndex(paths),
    root: PACKAGE_ROOT,
    read(key) {
      return bytes.get(key);
    },
  };
}

// -------------------------------------------------------------------
// 1. Synthetic Programs (discovery/language-readiness.md:257-268)
// -------------------------------------------------------------------

// 1. Expression-heavy code with nested call arguments/indexes, deep recursion, locals shadowing globals, autoLocal(true).
const SYNTHETIC_1_SOURCE = `global(hits) = 0
count = 4
function twice(n) { return n + n }
function bump(&n) { n = n + 1 }
function ref() { return &count }
function sum(n) {
  if (n <= 0) { return 0 }
  return n + sum(n - 1)
}
function fact(n) {
  if (n <= 1) { return 1 }
  return n * fact(n - 1)
}
function classify(v) {
  switch (v) {
    case (0) { return "none" }
    case (1): { return "one" }
    default: { return "many" }
  }
  return "unreachable"
}
local(i) = 0
total = 0
while (i < 3) { total = total + twice(i); i = i + 1 }
until (i >= 5) { i = i + 1 }
for (local(j) = 0; j < 2; ++j) { hits = hits + 1 }
bump(total)
ref() = 10
deep = sum(10)
big = fact(6)
label = classify(1)
off = "off"
if (off) { label = "truthy" } else { label = label + "!" }
mid = 1 + sleep(1) + 3
end()
`;

// 2. Classes: instantiate, copy, operator=, operator[] as lvalue, release() and destructor order, object hierarchy.
const SYNTHETIC_2_SOURCE = `class Node {
  public:
    var val
    method Node(v) { this.val = v }
}
class Container {
  public:
    var items[]
    var node
    method Container() {
      this.node = Node(42)
    }
    method ~Container() {
      this.items[0] = 0
    }
    method operator[](idx) {
      return &this.items[idx]
    }
}
c = Container()
c[0] = 10
c[1] = 20
val = c[0] + c[1] + c.node.val
c->release()
end()
`;

// 3. User functions with & parameters, with built-in by-reference outputs.
const SYNTHETIC_3_SOURCE = `function swap(&a, &b) {
  local(tmp) = a
  a = b
  b = tmp
}
x = 10
y = 20
swap(x, y)
r = 0
g = 0
b = 0
getcolor(r, g, b)
sz = 0
getfontsize(sz)
end()
`;

// 4. Error handlers: setErrorHandler, setResumeNextHandler, resumeNext, on error goto, on error resume next.
const SYNTHETIC_4_SOURCE = `function testHandlers() {
  setErrorHandler(:handler)
  triggerError = 10 % 0
  after = 1
  return 0
  :handler
  handled = 1
  setResumeNextHandler()
  triggerNext = 20 % 0
  recovered = 1
  return 42
}
res = testHandlers()
end()
`;

// 5. Threads: thread(), sleep, wake, getThreadId(), threadSleepRemaining(), killThread(), tellThread().
const SYNTHETIC_5_SOURCE = `myId = getThreadId()
bgId = thread("persistent", :worker)
sleep(2)
rem = threadSleepRemaining(bgId)
tellThread(bgId, "injected = 99")
sleep(2)
killThread(bgId)
end()

:worker
workerId = getThreadId()
workerCount = 1
sleep(3)
workerDone = 1
end()
`;

// 6. Includes and implicit includes (file.func), redirect/killRedirect.
const SYNTHETIC_6_LIB = `function libAdd(a, b) {
  return a + b
}
function libMul(a, b) {
  return a * b
}
`;
const SYNTHETIC_6_MAIN = `#include "lib.prg"
redirect("orig", "libAdd")
res1 = orig(2, 3)
killRedirect("orig")
res2 = libAdd(4, 5)
res3 = lib.libMul(6, 7)
end()
`;

// 7. Numbers: division, fmath power with fractions, -0, arrays, kill on elements.
const SYNTHETIC_7_SOURCE = `divSafe = 10 / 2
powFrac = 4 ^ 0.5
rem0 = 10 % 3
m_val = abs(-50)
rootVal = sqrt(16)
a[0] = 100
a[1] = 200
kill(a[1])
read0 = a[0]
end()
`;

// 8. File I/O round-trips through AD-17 requests.
const SYNTHETIC_8_SOURCE = `h = openFileOutput("test.txt", "files")
filePrint(h, "hello world")
closeFile(h)
h2 = openFileInput("test.txt", "files")
fileInput(h2, line)
closeFile(h2)
end()
`;

// 9. Compiler or source-hash mismatch on restore.
const SYNTHETIC_9_V1 = `x = 1
sleep(1)
y = 2
end()
`;

// 10. First-class callables saved and restored (FUN-8, entry 18.6): captured cells shared with a
// frame, a lambda parked mid-call by sleep, a bindingOf wrapper chain, lambdas made on every pass of
// a loop (their cells are freed), and a lambda stored in a global that the program which made it
// outlives (lib.prg calls it after main.prg has ended).
const SYNTHETIC_10_MAIN = `function make(start) {
  local(n)
  n = start
  return () => { n = n + 1; return n }
}
function slow(x) {
  return () => { sleep(1); return x * 2 }
}
function wrap() {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + 1
}
counter = make(10)
c1 = counter()
c2 = counter()
parked = slow(21)
handler = (v) => v + c2
wrap()
for (local(i) = 0; i < 8; ++i) { scratch = make(i); total = scratch() }
r = parked()
wrapped = castint(4.75)
run("lib.prg")
`;

const SYNTHETIC_10_LIB = `sleep(1)
late = handler(1)
end()
`;

// 11. Pure-RPGCode middleware (entry 18.7; the authored libraries under
// packages/core/test/fixtures/plugins/ in short): four layers wrap mwin through the one
// function that installs a layer, so each layer's tag is a captured cell of its own; a
// fifth wraps sleep, so a wrapper waits inside its call; the start-up program ends with
// run() and the game program uses layers that program made. The layer installed last runs
// first, so the engine sees the tags in reverse install order.
const SYNTHETIC_11_BOOT = `function layer(tag) {
  local(original)
  original = bindingOf("mwin")
  mwin = (text) => {
    trace = trace + tag + ">"
    r = original(tag + ":" + text)
    trace = trace + "<" + tag
    return r
  }
}
function pace() {
  local(original)
  original = bindingOf("sleep")
  sleep = (ticks) => {
    trace = trace + "pace>"
    original(ticks * 2)
    trace = trace + "<pace"
    return 0
  }
}
function counter() {
  local(n)
  n = 0
  bump = () => { n = n + 1; return n }
  total = () => n
}
trace = ""
layer("weather")
layer("audio")
layer("hud")
pace()
counter()
run("game.prg")
`;

const SYNTHETIC_11_GAME = `mwin("hello")
sleep(1)
bump()
mwin("again")
bump()
seen = total()
end()
`;

// 12. Cancelable emit (entry 19.11; EMIT-5, EMIT-16, EMIT-17): the emitting thread parks on an
// event.dispatch wait while four listeners run in registration order (one halves a damage
// field, one cancels, a once listener sees the cancel, one waits), then resumes with the
// event; a plain emit queued between the two cancelable emits never blocks the program.
const SYNTHETIC_12_SOURCE = `log = ""
guard = {}
steps = 0
guard.on("hit", (e) => { for (i = 0; i < 3; i = i + 1) { steps = steps + 1 }; e.detail.dmg = e.detail.dmg / 2; log = log + "s" })
guard.on("hit", (e) => { if (e.detail.dmg < 6) { e.cancel() }; log = log + "c" })
guard.once("hit", (e) => { log = log + "o" + e.canceled })
guard.on("hit", (e) => { threadSleep(getThreadId(), 0.02); log = log + "z" })
first = guard.emitCancelable("hit", { dmg: 10 })
log = log + "|" + first.canceled + first.detail.dmg
guard.emit("note", { dmg: 6 })
second = guard.emitCancelable("hit", { dmg: 40 })
log = log + "|" + second.canceled + second.detail.dmg
end()
`;

// 13. Package command layers through registerPlugin (entry 19.8; MOD-4, PKG-5):
// two packages register wrappers for mwin and sleep; layers run in reverse registration order;
// a layer waits; removing a package leaves the remaining layers working; save/restore
// rebuilds the layer table via packageStartups before resuming parked threads.
const SYNTHETIC_13_BOOT_CHIME = `registerPlugin({
  name: "chime",
  commands: {
    mwin: (line, next) => {
      trace = trace + "c>"
      r = next("c:" + line)
      trace = trace + "<c"
      return r
    }
  }
})
`;

const SYNTHETIC_13_BOOT_SHOUT = `shout = registerPlugin({
  name: "shout",
  commands: {
    mwin: (line, next) => {
      trace = trace + "s>"
      r = next(ucase(line))
      trace = trace + "<s"
      return r
    },
    sleep: (ticks, next) => {
      trace = trace + "p>"
      next(ticks * 2)
      trace = trace + "<p"
      return 0
    }
  }
})
`;

const SYNTHETIC_13_GAME = `trace = ""
mwin("hi")
sleep(1)
shout.remove()
mwin("again")
end()
`;

// -------------------------------------------------------------------
// Synthetic TK2 Program (dialect, # prefixes, sigils, loose dialogue, methods)
// -------------------------------------------------------------------

const SYNTHETIC_TK2_SOURCE = `#Method AddOne(v!) {
#ReturnMethod(v + 1)
}
#score! = 10
#name$ = "hero"
#If (score = 10) {
#val! = AddOne(score)
#SetImage(title.gif, 0, 0, 32, 32)
#WalkSpeed(Fast)
}
Hello from TK2!
:done
#End()
`;

// -------------------------------------------------------------------
// Legacy sample program sources (embedded for pure runner-harness portability)
// -------------------------------------------------------------------

const SAMPLE_DEMO_START_SOURCE = `fontSize(18);
bold(true);
clear();
menuGraphic("layout.png");
fightMenuGraphic("mwin.jpg");
winGraphic("mwin.jpg");
spriteTranslucency(25);
mediaPlay("vip - title2.mid");
while (true)
{
	drawTitle();
	text(17, 10.5, "New Game");
	text(17, 12, "Load Game");
	text(17, 13.5, "Quit");
	cMap = createCursorMap();
	cursorMapAdd(295, 180, cMap);
	cursorMapAdd(295, 210, cMap);
	cursorMapAdd(295, 230, cMap);
	res = cursorMapRun(cMap);
	killCursorMap(cMap);
	switch (res)
	{
		case(0)
		{
			intro();
			end();
		}
		case(1)
		{
			file = dirSav("Select a saved file to load");
			if(file ~= "CANCEL")
			{
				load(file);
				end();
			}
		}
		case(2)
		{
			windows();
		}
	}
}
method drawTitle()
{
	clear();
	text(3, 3, "Test Game");
}
method intro()
{
	mwin("Your story goes here...");
	wait();
}
`;

const SAMPLE_BASIC_START_SOURCE = `#include "system.prg"
autolocal(true);
font("Comic Sans MS");
fontSize(18);
bold(true);
clear();
menuGraphic("layout.png");
fightMenuGraphic("mwin.jpg");
winGraphic("mwin.jpg");
mediaPlay("vip - title2.mid");
while (true)
{
	drawTitle();
	text(17, 10.5, "New Game");
	text(17, 12, "Load Game");
	text(17, 13.5, "Quit");
	cMap = createCursorMap();
	cursorMapAdd(295, 180, cMap);
	cursorMapAdd(295, 210, cMap);
	cursorMapAdd(295, 230, cMap);
	res = cursorMapRun(cMap);
	killCursorMap(cMap);
	switch (res)
	{
		case (0)
		{
			intro();
			end();
		}
		case (1)
		{
			file = dirSav("Select a saved file to load");
			if (file ~= "CANCEL")
			{
				load(file);
				end();
			}
		}
		case (2)
		{
			windows();
		}
	}
}
method drawTitle()
{
	clear();
	text(3, 3, "Test Game");
}
method intro()
{
	mwin("Your story goes here...");
	pause();
}
`;

const SAMPLE_SYSTEM_SOURCE = `method pause() {
	local(key) = "LEFT";
	until (key ~= "LEFT"  && _
			key ~= "RIGHT" && _
			key ~= "UP"    && _
			key ~= "DOWN") {
		key = wait();
	}
	return key;
}
class CArray {
	public:
		var m_data[]
		var m_isDynamic
		method CArray(int size) {
			if (m_isDynamic = (size <= 0)) {
				return;
			}
			m_data[size - 1] = 0;
		}
		method ~CArray() {
			clean();
		}
		method operator[](int index) {
			if (m_isDynamic && index >= length()) {
				resize(index + 1);
			}
			return &m_data[index];
		}
		method clean() {
			kill(m_data);
		}
		method getBound() {
			return length() - 1;
		}
		method length() {
			return length(m_data);
		}
		method resize(int size) {
			m_data[size - 1] = 0;
		}
}
method abs(double n) {
	if (n < 0) {
		return -n;
	}
	return n;
}
method min(double n1, double n2) {
	if (n1 < n2) {
		return n1;
	}
	return n2;
}
method max(double n1, double n2) {
	if (n1 > n2) {
		return n1;
	}
	return n2;
}
`;
const SAMPLE_DEMO_SYS_TEST_SOURCE = "";

const SAMPLE_DEMO_WIN_SOURCE = `mwin("Arr, ye beat me!");
wait();
mwincls();
eraseItem("source");
`;

const SAMPLE_DEMO_OLDMAN_SOURCE = `mwin("Welcome to the demo!");
mwin("This game provides a short demonstration of some of the Toolkit's new features.");
mwin("Press Enter to access the default menu system.");
mwin("Go outside to fight in the default battle system.");
wait();
`;

const SAMPLE_DEMO_MAN_SOURCE = `mwin("Arr, prepare to fight!");
wait();
mwincls();
fightEnemy("pirate.ene", "bkg.bkg");
`;

const SAMPLE_DEMO_MAN_WANDER_SOURCE = `method abs(x)
{
	return (x < 0 ? -x : x);
}
range = 256;
intercept = 96;
while(true)
{
	playerLocation("frap", px, py, z);
	itemLocation("source", ix, iy, z);
	if ((abs(px - ix) < intercept) && (abs(py - iy) < intercept))
	{
		itemPath("source", tkMV_PAUSE_THREAD | tkMV_PATHFIND, px, py);
		playerLocation("frap", x, y, z);
		if ((x == px) && (y == py))
		{
			run("man.prg");
			end();
		}
	}
	else
	{
		x = random(range * 2) - range;
		y = random(range * 2) - range;
		itemPath("source", tkMV_PAUSE_THREAD | tkMV_PATHFIND, ix + x, iy + y);
	}
	threadSleep(getThreadId(), 0.5);
}
`;

const SAMPLE_BASIC_WANDER_SOURCE = `//------------------------------------------------------------------
// Item wandering thread
//------------------------------------------------------------------
// Set this program is the program to run while on board for an item
// and they will wander around the board.
//------------------------------------------------------------------

// Infinite loop.
while (true)
{
	// Cause the target (this item) to wander.
	wander("target");
}

`;

export type FetchedGameFiles = {
  readonly demo: Record<string, string | Uint8Array>;
  readonly basic: Record<string, string | Uint8Array>;
};

export function buildFetchedCorpus(files: FetchedGameFiles): readonly CorpusProgram[] {
  const demoLoader = createMemoryLoader(files.demo);
  const basicLoader = createMemoryLoader(files.basic);

  return [
    {
      id: "sample-start-demo",
      name: "demo/start.prg",
      description: "The shipped demo startup program, driven headlessly with scripted key inputs",
      ticks: 3,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "start.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
      inputsForTick: (tick) => {
        if (tick === 1) return [{ tick: 1, event: { kind: "key", name: "0", code: "0", char: "0", down: true } }];
        if (tick === 2) return [{ tick: 2, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }];
        return [];
      },
    },
    {
      id: "sample-system-demo",
      name: "demo/system.prg",
      description: "The shipped demo system library containing CArray, math methods and helpers",
      ticks: 1,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "system.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
    },
    {
      id: "sample-sys-test-demo",
      name: "demo/sys_test.prg",
      description: "The 0-byte sample program in demo, completes immediately in 1 tick",
      ticks: 1,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "sys_test.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
    },
    {
      id: "sample-win-demo",
      name: "demo/win.prg",
      description: "The defeated pirate event program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "win.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-oldman-demo",
      name: "demo/oldman.prg",
      description: "The introduction NPC dialogue program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "oldman.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-man-demo",
      name: "demo/man.prg",
      description: "The intercept battle challenge program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "man.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-man-wander-demo",
      name: "demo/man_wander.prg",
      description: "The wandering and intercept thread program with run(\"man.prg\"), completes headlessly in 4 ticks",
      ticks: 4,
      createHost: (seed) => {
        const ref = fileProgramRef(demoLoader, "man_wander.prg");
        return createScriptHost({ program: ref, loader: demoLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: demoLoader }),
      inputsForTick: (t) => t === 3 ? [{ tick: 3, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-start-basic",
      name: "Basic/start.prg",
      description: "The shipped Basic startup program with #include system.prg, driven with scripted inputs",
      ticks: 3,
      createHost: (seed) => {
        const ref = fileProgramRef(basicLoader, "start.prg");
        return createScriptHost({ program: ref, loader: basicLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: basicLoader }),
      inputsForTick: (tick) => {
        if (tick === 1) return [{ tick: 1, event: { kind: "key", name: "0", code: "0", char: "0", down: true } }];
        if (tick === 2) return [{ tick: 2, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }];
        return [];
      },
    },
    {
      id: "sample-system-basic",
      name: "Basic/system.prg",
      description: "The shipped Basic system library containing CArray and helper methods",
      ticks: 1,
      createHost: (seed) => {
        const ref = fileProgramRef(basicLoader, "system.prg");
        return createScriptHost({ program: ref, loader: basicLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: basicLoader }),
    },
    {
      id: "sample-wander-basic",
      name: "Basic/wander.prg",
      description: "The infinite wandering loop program, verified under defined finish line of 5 ticks",
      ticks: 5,
      createHost: (seed) => {
        const ref = fileProgramRef(basicLoader, "wander.prg");
        return createScriptHost({ program: ref, loader: basicLoader, seed });
      },
      restoreHost: (json) => restoreScriptHost(json, { loader: basicLoader }),
    },
  ];
}

export function runFetchedCorpus(files: FetchedGameFiles, seed = 0): readonly ProgramResult[] {
  const programs = buildFetchedCorpus(files);
  const results: ProgramResult[] = [];
  for (const program of programs) {
    results.push(runCorpusProgram(program, seed));
  }
  return results;
}

// -------------------------------------------------------------------
// Assembled Corpus Program Definitions
// -------------------------------------------------------------------

// 14 to 16. The package fixtures of entry 19.14 (the authored programs under
// packages/core/test/fixtures/platform/; the copies are in ./platform-fixtures.ts): one
// package of dictionary objects and a class, one of emitter listeners with a shield that halves
// damage, and two namespaced packages where the later overrides the earlier. A package's
// start-up program is owned by the package (PKG-8) and runs before the game on a fresh state
// (PKG-5); a restore runs the same start-up programs again before it loads the save.
type PlatformFixture = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ticks: number;
  readonly main: string;
  readonly startups: readonly { readonly file: string; readonly owner: string }[];
};

function platformProgram(fixture: PlatformFixture): CorpusProgram {
  const make = (): { loader: ProgramLoader; startups: readonly PackageStartupRef[] } => {
    const loader = createMemoryLoader(PLATFORM_FIXTURE_SOURCES);
    return {
      loader,
      startups: fixture.startups.map((entry) => ({ owner: entry.owner, ref: fileProgramRef(loader, entry.file) })),
    };
  };
  return {
    id: fixture.id,
    name: fixture.name,
    description: fixture.description,
    ticks: fixture.ticks,
    createHost: (seed) => {
      const { loader, startups } = make();
      return createScriptHost({
        program: fileProgramRef(loader, fixture.main),
        loader,
        packageStartups: startups,
        seed,
      });
    },
    restoreHost: (json) => {
      const { loader, startups } = make();
      return restoreScriptHost(json, { loader, packageStartups: startups });
    },
  };
}

const PLATFORM_FIXTURES: readonly PlatformFixture[] = [
  {
    id: "synthetic-14-object-package",
    name: "Synthetic 14 (Object-Model Package)",
    description:
      "Fighters as dictionary objects with a hit method: a direct call, a method taken out of its object, one rebound with bindThis, a legacy class instance on the same storage, kill of a field and random damage from the seed",
    ticks: 8,
    main: "fighters-game.prg",
    startups: [],
  },
  {
    id: "synthetic-15-emitter-package",
    name: "Synthetic 15 (Emitter Package With A Shield)",
    description:
      "A package whose shield listener halves damage on a cancelable emit, a guard that cancels weak hits, a listener that waits, once and off, plain emits queued behind the emitter and a fallen event on the game emitter",
    ticks: 20,
    main: "shield-game.prg",
    startups: [{ file: "shield.prg", owner: "shield" }],
  },
  {
    id: "synthetic-16-namespaced-packages",
    name: "Synthetic 16 (Namespaced Packages With An Override)",
    description:
      "Two packages that each keep a namespace object and a plain rain command: the later package overrides the plain command and the mwin layer and hands on to the earlier, qualified calls reach each package's own rain, and one call takes the override off again",
    ticks: 8,
    main: "namespaces-game.prg",
    startups: [
      { file: "weather.prg", owner: "weather" },
      { file: "storm.prg", owner: "storm" },
    ],
  },
];

export function buildCorpus(): readonly CorpusProgram[] {
  const programs: CorpusProgram[] = [
    {
      id: "synthetic-1-expressions",
      name: "Synthetic 1 (Expressions & Recursion)",
      description: "Expression-heavy code with nested calls, deep recursion, locals shadowing globals, autoLocal",
      ticks: 2,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_1_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-2-classes",
      name: "Synthetic 2 (OOP Classes & Operators)",
      description: "Classes, constructors, destructors, operator=, operator[] as lvalue, release(), object hierarchy",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_2_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-3-byref",
      name: "Synthetic 3 (ByRef & Builtin Outputs)",
      description: "User functions with & parameters, built-in by-reference outputs (getcolor, getfontsize)",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_3_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-4-errors",
      name: "Synthetic 4 (Error Handlers)",
      description: "Error handlers: setErrorHandler, setResumeNextHandler, resumeNext, on error goto/resume next",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_4_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-5-threads",
      name: "Synthetic 5 (Cooperative Threads)",
      description: "Threads: thread(), sleep, wake, getThreadId(), threadSleepRemaining(), killThread(), tellThread()",
      ticks: 5,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_5_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-6-modules",
      name: "Synthetic 6 (Modules & Includes)",
      description: "#include, hoisted definitions, implicit include file.func, redirect/killRedirect",
      ticks: 1,
      createHost: (seed) => {
        const loader = createMemoryLoader({
          "main.prg": SYNTHETIC_6_MAIN,
          "lib.prg": SYNTHETIC_6_LIB,
        });
        const ref = fileProgramRef(loader, "main.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({
          "main.prg": SYNTHETIC_6_MAIN,
          "lib.prg": SYNTHETIC_6_LIB,
        });
        return restoreScriptHost(json, { loader });
      },
    },
    {
      id: "synthetic-7-numbers",
      name: "Synthetic 7 (Numbers & Arrays)",
      description: "Division, fmath powers with fractions, abs, sqrt, array elements and element kill",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_7_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-8-file-io",
      name: "Synthetic 8 (Sandboxed File I/O)",
      description: "File I/O round-trips through AD-17 requests: openFileOutput, filePrint, openFileInput, fileInput",
      ticks: 3,
      createHost: (seed, context) => {
        const blobs = context?.blobs ?? { blobs: {} };
        return createScriptHost({ program: SYNTHETIC_8_SOURCE, seed, blobs, gameId: "game" });
      },
      restoreHost: (json, context) => {
        const blobs = context?.blobs ?? { blobs: {} };
        return restoreScriptHost(json, { blobs, gameId: "game" });
      },
    },
    {
      id: "synthetic-9-mismatch",
      name: "Synthetic 9 (Source Hash Mismatch Restart)",
      description: "File program restarts from updated source with fresh frame on snapshot restore",
      ticks: 2,
      createHost: (seed) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_9_V1 });
        const ref = fileProgramRef(loader, "main.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_9_V1 });
        return restoreScriptHost(json, { loader });
      },
    },
    {
      id: "synthetic-10-closures",
      name: "Synthetic 10 (Closures, Cells & Save/Restore)",
      description:
        "Lambdas with captured cells, a lambda parked mid-call by sleep, a bindingOf wrapper, lambdas made in a loop (their cells freed), and a handle that outlives the program that made it",
      ticks: 6,
      createHost: (seed) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_10_MAIN, "lib.prg": SYNTHETIC_10_LIB });
        const ref = fileProgramRef(loader, "main.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_10_MAIN, "lib.prg": SYNTHETIC_10_LIB });
        return restoreScriptHost(json, { loader });
      },
    },
    {
      id: "synthetic-11-middleware",
      name: "Synthetic 11 (Pure-RPGCode Middleware)",
      description:
        "Three layers wrapping mwin and one wrapping sleep through bindingOf, closure cells shared by a counter's handles, and a game program that uses layers its start-up program installed and ended",
      ticks: 10,
      createHost: (seed) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_11_BOOT, "game.prg": SYNTHETIC_11_GAME });
        const ref = fileProgramRef(loader, "main.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({ "main.prg": SYNTHETIC_11_BOOT, "game.prg": SYNTHETIC_11_GAME });
        return restoreScriptHost(json, { loader });
      },
    },
    {
      id: "synthetic-12-cancelable-emit",
      name: "Synthetic 12 (Cancelable Emit)",
      description:
        "A cancelable emit that parks its thread on an event.dispatch wait while four listeners halve a field, cancel, see the cancel and wait, then resumes with the event; a plain emit between two cancelable emits",
      ticks: 20,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_12_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "synthetic-13-package-layers",
      name: "Synthetic 13 (Package Command Layers)",
      description:
        "Package command layers registered by registerPlugin in packageStartups, onion dispatch through next, a layer that waits, mid-game package removal, and save/restore",
      ticks: 3,
      createHost: (seed) => {
        const loader = createMemoryLoader({
          "chime.prg": SYNTHETIC_13_BOOT_CHIME,
          "shout.prg": SYNTHETIC_13_BOOT_SHOUT,
          "game.prg": SYNTHETIC_13_GAME,
        });
        const ref = fileProgramRef(loader, "game.prg");
        const startups = [
          { owner: "chime", ref: fileProgramRef(loader, "chime.prg") },
          { owner: "shout", ref: fileProgramRef(loader, "shout.prg") },
        ];
        return createScriptHost({ program: ref, loader, packageStartups: startups, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({
          "chime.prg": SYNTHETIC_13_BOOT_CHIME,
          "shout.prg": SYNTHETIC_13_BOOT_SHOUT,
          "game.prg": SYNTHETIC_13_GAME,
        });
        const startups = [
          { owner: "chime", ref: fileProgramRef(loader, "chime.prg") },
          { owner: "shout", ref: fileProgramRef(loader, "shout.prg") },
        ];
        return restoreScriptHost(json, { loader, packageStartups: startups });
      },
    },
    ...PLATFORM_FIXTURES.map(platformProgram),
    {
      id: "synthetic-tk2",
      name: "Synthetic TK2 Dialect",
      description: "TK2 statement introducers (#), sigils, blocks, loose text, methods, and mapped commands",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SYNTHETIC_TK2_SOURCE, dialect: "tk2", seed }),
      restoreHost: (json) => restoreScriptHost(json, { dialect: "tk2" }),
    },
    {
      id: "sample-start-demo",
      name: "demo/start.prg",
      description: "The shipped demo startup program, driven headlessly with scripted key inputs",
      ticks: 3,
      createHost: (seed) => createScriptHost({ program: SAMPLE_DEMO_START_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
      inputsForTick: (tick) => {
        if (tick === 1) {
          return [{
            tick: 1,
            event: { kind: "key", name: "0", code: "0", char: "0", down: true },
          }];
        }
        if (tick === 2) {
          return [{
            tick: 2,
            event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true },
          }];
        }
        return [];
      },
    },
    {
      id: "sample-start-basic",
      name: "Basic/start.prg",
      description: "The shipped Basic startup program with #include system.prg, driven with scripted inputs",
      ticks: 3,
      createHost: (seed) => {
        const loader = createMemoryLoader({
          "start.prg": SAMPLE_BASIC_START_SOURCE,
          "system.prg": SAMPLE_SYSTEM_SOURCE,
        });
        const ref = fileProgramRef(loader, "start.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({
          "start.prg": SAMPLE_BASIC_START_SOURCE,
          "system.prg": SAMPLE_SYSTEM_SOURCE,
        });
        return restoreScriptHost(json, { loader });
      },
      inputsForTick: (tick) => {
        if (tick === 1) {
          return [{
            tick: 1,
            event: { kind: "key", name: "0", code: "0", char: "0", down: true },
          }];
        }
        if (tick === 2) {
          return [{
            tick: 2,
            event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true },
          }];
        }
        return [];
      },
    },
    {
      id: "sample-system-demo",
      name: "demo/system.prg",
      description: "The shipped demo system library containing CArray, math methods and helpers",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SAMPLE_SYSTEM_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "sample-system-basic",
      name: "Basic/system.prg",
      description: "The shipped Basic system library containing CArray and helper methods",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SAMPLE_SYSTEM_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "sample-sys-test-demo",
      name: "demo/sys_test.prg",
      description: "The 0-byte sample program in demo, completes immediately in 1 tick",
      ticks: 1,
      createHost: (seed) => createScriptHost({ program: SAMPLE_DEMO_SYS_TEST_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
    },
    {
      id: "sample-win-demo",
      name: "demo/win.prg",
      description: "The defeated pirate event program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => createScriptHost({ program: SAMPLE_DEMO_WIN_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-oldman-demo",
      name: "demo/oldman.prg",
      description: "The introduction NPC dialogue program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => createScriptHost({ program: SAMPLE_DEMO_OLDMAN_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-man-demo",
      name: "demo/man.prg",
      description: "The intercept battle challenge program, completes headlessly in 2 ticks with scripted input",
      ticks: 2,
      createHost: (seed) => createScriptHost({ program: SAMPLE_DEMO_MAN_SOURCE, seed }),
      restoreHost: (json) => restoreScriptHost(json, {}),
      inputsForTick: (t) => t === 1 ? [{ tick: 1, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-man-wander-demo",
      name: "demo/man_wander.prg",
      description: "The wandering and intercept thread program with run(\"man.prg\"), completes headlessly in 4 ticks",
      ticks: 4,
      createHost: (seed) => {
        const loader = createMemoryLoader({
          "man_wander.prg": SAMPLE_DEMO_MAN_WANDER_SOURCE,
          "man.prg": SAMPLE_DEMO_MAN_SOURCE,
        });
        const ref = fileProgramRef(loader, "man_wander.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({
          "man_wander.prg": SAMPLE_DEMO_MAN_WANDER_SOURCE,
          "man.prg": SAMPLE_DEMO_MAN_SOURCE,
        });
        return restoreScriptHost(json, { loader });
      },
      inputsForTick: (t) => t === 3 ? [{ tick: 3, event: { kind: "key", name: "ENTER", code: "ENTER", char: null, down: true } }] : [],
    },
    {
      id: "sample-wander-basic",
      name: "Basic/wander.prg",
      description: "The infinite wandering loop program, verified under defined finish line of 5 ticks",
      ticks: 5,
      createHost: (seed) => {
        const loader = createMemoryLoader({ "wander.prg": SAMPLE_BASIC_WANDER_SOURCE });
        const ref = fileProgramRef(loader, "wander.prg");
        return createScriptHost({ program: ref, loader, seed });
      },
      restoreHost: (json) => {
        const loader = createMemoryLoader({ "wander.prg": SAMPLE_BASIC_WANDER_SOURCE });
        return restoreScriptHost(json, { loader });
      },
    },
  ];

  return programs;
}

// -------------------------------------------------------------------
// Catalogue Completeness Verification
// -------------------------------------------------------------------

export function verifyCatalogueCompleteness(
  catalogueNames: readonly string[],
  mappedTk2Commands: readonly { readonly name: string; readonly mapsTo?: string }[],
): {
  readonly catalogueCount: number;
  readonly mappedCount: number;
} {
  const state = createGameState({ seed: 0 });
  const plugins = [
    { definition: CORE_PLUGIN },
    { definition: MEDIA_PLUGIN },
    { definition: BATTLE_PLUGIN },
    { definition: CATALOGUE_PLUGIN },
    { definition: WORLD_PLUGIN },
    { definition: TK2_COMPAT_PLUGIN },
  ];
  const services = createScriptServices(state, plugins);

  const missingCatalogue: string[] = [];
  for (const name of catalogueNames) {
    const cmd = services.commands.get(name.toLowerCase());
    if (cmd === undefined) {
      missingCatalogue.push(name);
    }
  }

  if (missingCatalogue.length > 0) {
    throw new Error(
      `Catalogue completeness failed: ${missingCatalogue.length} names did not resolve: ${missingCatalogue.join(", ")}`,
    );
  }

  const PARSER_KEYWORDS: Record<string, true> = {
    for: true,
    if: true,
    include: true,
    "#include": true,
    method: true,
    function: true,
    returnmethod: true,
    return: true,
    while: true,
    redirect: true,
    killredirect: true,
  };

  const missingMapped: string[] = [];
  for (const item of mappedTk2Commands) {
    const target = (item.mapsTo && item.mapsTo !== "" ? item.mapsTo : item.name).toLowerCase();
    if (PARSER_KEYWORDS[item.name.toLowerCase()] !== true && PARSER_KEYWORDS[target] !== true) {
      const cmd = services.commands.get(target);
      if (cmd === undefined) {
        missingMapped.push(`${item.name} -> ${target}`);
      }
    }
  }

  if (missingMapped.length > 0) {
    throw new Error(
      `TK2 mapped completeness failed: ${missingMapped.length} commands did not resolve: ${missingMapped.join(", ")}`,
    );
  }

  return { catalogueCount: catalogueNames.length, mappedCount: mappedTk2Commands.length };
}

// -------------------------------------------------------------------
// Execution & Snapshot Verification
// -------------------------------------------------------------------

export function runCorpusProgram(program: CorpusProgram, seed = 0): ProgramResult {
  // 1. Straight run to completion
  const straightContext: CorpusSessionContext = { blobs: { blobs: {} } };
  const host = program.createHost(seed, straightContext);
  for (let tick = 0; tick < program.ticks; tick += 1) {
    const inputs = program.inputsForTick ? program.inputsForTick(tick) : [];
    host.advance(1, inputs);
  }

  const finalHash = host.stateHash();

  // 2. Random-step snapshot and restore check
  const split = randomSplit(seed, program.ticks);
  const splitContext: CorpusSessionContext = { blobs: { blobs: {} } };
  const freshHost = program.createHost(seed, splitContext);
  for (let tick = 0; tick < split; tick += 1) {
    const inputs = program.inputsForTick ? program.inputsForTick(tick) : [];
    freshHost.advance(1, inputs);
  }

  const snap = freshHost.snapshot();
  const restoredHost = program.restoreHost(snap, splitContext);

  // Check state hash matches at every step from split to ticks
  checkSnapshotRestore(
    { fresh: freshHost, fromSnapshot: restoredHost },
    { ticks: program.ticks - split, split, inputsForTick: program.inputsForTick },
  );

  return {
    id: program.id,
    ticks: program.ticks,
    stateHash: finalHash,
  };
}

export function runAllCorpusPrograms(seed = 0): readonly ProgramResult[] {
  const corpus = buildCorpus();
  const results: ProgramResult[] = [];
  for (const program of corpus) {
    results.push(runCorpusProgram(program, seed));
  }
  return results;
}

// golden/scripts/golden.json: #585 re-pinned only the two sample-start hashes when menuGraphic began storing its
// image in menu.graphic; reverting that command to the old mixed/ui responder reproduces the prior hashes.
export function formatScriptsGolden(results: readonly ProgramResult[]): string {
  const payload: ScriptsGolden = {
    schema: 1,
    programs: results.map((r) => ({ id: r.id, hash: r.stateHash })),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

export function compareScriptsGolden(
  results: readonly ProgramResult[],
  goldenJson: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  let parsed: ScriptsGolden;
  try {
    parsed = JSON.parse(goldenJson) as ScriptsGolden;
  } catch (err) {
    return { ok: false, message: `golden/scripts/golden.json is malformed: ${String(err)}` };
  }

  if (parsed.schema !== 1 || !Array.isArray(parsed.programs)) {
    return { ok: false, message: "golden/scripts/golden.json: invalid schema or programs format" };
  }

  const expectedById = new Map(parsed.programs.map((p) => [p.id, p.hash]));
  for (const res of results) {
    const expected = expectedById.get(res.id);
    if (expected === undefined) {
      return { ok: false, message: `golden/scripts/golden.json lacks entry for program '${res.id}'` };
    }
    if (expected !== res.stateHash) {
      return {
        ok: false,
        message: `program '${res.id}' hash mismatch: expected ${expected}, got ${res.stateHash}`,
      };
    }
  }

  return { ok: true };
}
