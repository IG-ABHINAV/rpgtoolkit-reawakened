/**
 * Recovery candidate promotion and selection (#783;
 * docs/spec/engine/interruption-recovery.md#reference-recovery-store-layout).
 *
 * The in-memory store injects host failures at each step (candidate write,
 * read-back, metadata, atomic pointer, removal) so the tests prove that a
 * failed promotion leaves the old pointer selected and that selection never
 * returns a candidate that did not just pass validation.
 */
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  hashGameLedger,
  hashGameLedgerV3,
  projectGameLedger,
  promoteRecovery,
  RecoveryStoreError,
  selectRecovery,
  utf8Decode,
  utf8Encode,
  type RecoveryStorage,
  type RecoveryValidate,
  type ValidatedRecovery,
} from "../src/index.ts";

type Fault = (path: string, bytes: Uint8Array) => void;

class MemoryStore implements RecoveryStorage {
  readonly files = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  readonly atomicWrites: string[] = [];
  beforeWrite: Fault | null = null;
  beforeAtomicWrite: Fault | null = null;
  /** Return replacement bytes for a read, `null` to hide the file, or undefined to use storage. */
  readOverride: ((path: string) => Uint8Array | null | undefined) | null = null;

  read(path: string): Uint8Array | null {
    if (this.readOverride !== null) {
      const override = this.readOverride(path);
      if (override !== undefined) return override;
    }
    const bytes = this.files.get(path);
    return bytes === undefined ? null : bytes;
  }

  write(path: string, bytes: Uint8Array): void {
    this.beforeWrite?.(path, bytes);
    this.writes.push(path);
    this.files.set(path, bytes.slice());
  }

  writeAtomic(path: string, bytes: Uint8Array): void {
    this.beforeAtomicWrite?.(path, bytes);
    this.atomicWrites.push(path);
    this.files.set(path, bytes.slice());
  }

  list(prefix: string): readonly string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  remove(path: string): void {
    this.files.delete(path);
  }
}

/** A host that cannot delete paths keeps the extra generations but must still select safely. */
function withoutRemove(store: MemoryStore): RecoveryStorage {
  return {
    read: (path) => store.read(path),
    write: (path, bytes) => store.write(path, bytes),
    writeAtomic: (path, bytes) => store.writeAtomic(path, bytes),
    list: (prefix) => store.list(prefix),
  };
}

type Candidate = { readonly tick: number; readonly ledgerHash: string; readonly bytes: Uint8Array };

function candidate(tick: number, ledgerHash = `hash-${tick}`, bad = false): Candidate {
  return { tick, ledgerHash, bytes: utf8Encode(JSON.stringify({ tick, ledgerHash, bad })) };
}

const validate: RecoveryValidate = (bytes) => {
  const parsed = JSON.parse(utf8Decode(bytes)) as { tick?: unknown; ledgerHash?: unknown; bad?: unknown };
  if (parsed.bad === true) throw new Error("candidate is invalid");
  if (typeof parsed.tick !== "number" || typeof parsed.ledgerHash !== "string") throw new Error("candidate shape");
  return { tick: parsed.tick, ledgerHash: parsed.ledgerHash };
};

const GAME = "0123456789abcdef";

function pointerPath(gameId = GAME): string {
  return `${gameId}/recovery/current.json`;
}

function generationFile(generation: number, file: string, gameId = GAME): string {
  return `${gameId}/recovery/generations/${String(generation).padStart(12, "0")}/${file}`;
}

function readJson(store: MemoryStore, path: string): Record<string, unknown> {
  const bytes = store.read(path);
  if (bytes === null) throw new Error(`expected ${path}`);
  return JSON.parse(utf8Decode(bytes)) as Record<string, unknown>;
}

function pointerOf(store: MemoryStore, gameId = GAME): Record<string, unknown> {
  return readJson(store, pointerPath(gameId));
}

function generationsIn(store: MemoryStore, gameId = GAME): number[] {
  const prefix = `${gameId}/recovery/generations/`;
  const generations = new Set<number>();
  for (const path of store.list(prefix)) generations.add(Number(path.slice(prefix.length, prefix.length + 12)));
  return [...generations].sort((left, right) => left - right);
}

function promoted(store: RecoveryStorage, value: Candidate): void {
  promoteRecovery(store, { gameId: GAME, bytes: value.bytes }, validate);
}

function selected(store: RecoveryStorage, gameId = GAME): ValidatedRecovery {
  const recovery = selectRecovery(store, { gameId }, validate);
  if (recovery === null) throw new Error("expected a selected recovery generation");
  return recovery;
}

function failureOf(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
}

function failureCode(run: () => void): string | null {
  const error = failureOf(run);
  return error instanceof RecoveryStoreError ? error.code : null;
}

function failureMessage(run: () => void): string | null {
  const error = failureOf(run);
  return error instanceof Error ? error.message : null;
}

test("promotion validates, writes the generation, then atomically switches the pointer", () => {
  const store = new MemoryStore();
  const first = candidate(41);
  const recovery = promoteRecovery(store, { gameId: GAME, bytes: first.bytes }, validate);

  equal(recovery.generation, 1);
  equal(recovery.tick, 41);
  equal(recovery.ledgerHash, "hash-41");
  deepEqual(recovery.bytes, first.bytes);
  deepEqual(store.writes, [generationFile(1, "candidate.bin"), generationFile(1, "meta.json")]);
  deepEqual(store.atomicWrites, [pointerPath()]);
  deepEqual(pointerOf(store), { version: 1, gameId: GAME, generation: 1, tick: 41, ledgerHash: "hash-41" });
  deepEqual(readJson(store, generationFile(1, "meta.json")), { version: 1, generation: 1, tick: 41, ledgerHash: "hash-41" });

  const recoverySelected = selected(store);
  equal(recoverySelected.generation, 1);
  equal(recoverySelected.tick, 41);
  equal(recoverySelected.ledgerHash, "hash-41");
  deepEqual(recoverySelected.bytes, first.bytes);
});

test("an empty recovery area selects nothing", () => {
  const store = new MemoryStore();
  equal(selectRecovery(store, { gameId: GAME }, validate), null);
});

test("a refused candidate writes nothing and leaves the previous pointer selected", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);

  equal(failureMessage(() => promoted(store, candidate(6, "hash-6", true))), "candidate is invalid");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a candidate write failure leaves the previous pointer selected", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  store.beforeWrite = (path) => {
    if (path === generationFile(2, "candidate.bin")) throw new Error("disk full");
  };

  equal(failureMessage(() => promoted(store, candidate(6))), "disk full");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a metadata write failure leaves the previous pointer selected", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  store.beforeWrite = (path) => {
    if (path === generationFile(2, "meta.json")) throw new Error("metadata full");
  };

  equal(failureMessage(() => promoted(store, candidate(6))), "metadata full");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a read-back that is missing or validates differently refuses promotion", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);

  store.readOverride = (path) => (path === generationFile(2, "candidate.bin") ? candidate(6, "hash-tampered").bytes : undefined);
  equal(failureCode(() => promoted(store, candidate(6))), "recovery.readback");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);

  store.readOverride = (path) => (path === generationFile(3, "candidate.bin") ? null : undefined);
  equal(failureCode(() => promoted(store, candidate(7))), "recovery.readback");
  equal(pointerOf(store).generation, 1);
});

test("a metadata read-back that disagrees refuses promotion", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  const wrongMeta = utf8Encode(JSON.stringify({ version: 1, generation: 2, tick: 999, ledgerHash: "hash-999" }));
  store.readOverride = (path) => (path === generationFile(2, "meta.json") ? wrongMeta : undefined);

  equal(failureCode(() => promoted(store, candidate(6))), "recovery.readback");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a pointer write failure leaves the previous pointer selected", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  let interrupted = false;
  store.beforeAtomicWrite = () => {
    if (interrupted) return;
    interrupted = true;
    throw new Error("pointer write interrupted");
  };

  equal(failureMessage(() => promoted(store, candidate(6))), "pointer write interrupted");
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a pointer that did not read back restores the previous pointer", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  let switched = false;
  store.readOverride = (path) => {
    if (path !== pointerPath() || !switched) return undefined;
    return utf8Encode(JSON.stringify({ version: 1, gameId: GAME, generation: 1, tick: 5, ledgerHash: "hash-5" }));
  };
  store.beforeAtomicWrite = (path) => {
    if (path === pointerPath()) switched = true;
  };

  equal(failureCode(() => promoted(store, candidate(6))), "recovery.pointer");
  switched = false;
  equal(pointerOf(store).generation, 1);
  deepEqual(selected(store).bytes, previous.bytes);
});

test("a corrupt pointer selects the newest valid generation and repairs the pointer", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  store.files.set(pointerPath(), utf8Encode("{ not a pointer"));

  const recovery = selected(store);
  equal(recovery.generation, 1);
  deepEqual(recovery.bytes, previous.bytes);
  deepEqual(pointerOf(store), { version: 1, gameId: GAME, generation: 1, tick: 5, ledgerHash: "hash-5" });
});

test("a missing candidate falls back to the retained previous generation", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  promoted(store, candidate(6));
  equal(pointerOf(store).generation, 2);
  store.files.delete(generationFile(2, "candidate.bin"));

  const recovery = selected(store);
  equal(recovery.generation, 1);
  deepEqual(recovery.bytes, previous.bytes);
  equal(pointerOf(store).generation, 1);
});

test("an invalid newest generation falls back and is never returned", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  const previous = candidate(6);
  promoted(store, previous);
  promoted(store, candidate(7));
  equal(pointerOf(store).generation, 3);

  const bad = candidate(7, "hash-7", true);
  store.files.set(generationFile(3, "candidate.bin"), bad.bytes);
  const recovery = selected(store);
  equal(recovery.generation, 2);
  deepEqual(recovery.bytes, previous.bytes);
  equal(pointerOf(store).generation, 2);
});

test("changed candidate bytes that no longer match the recorded validation are refused", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  promoted(store, candidate(6));
  store.files.set(generationFile(2, "candidate.bin"), candidate(60, "hash-60").bytes);

  const recovery = selected(store);
  equal(recovery.generation, 1);
  deepEqual(recovery.bytes, previous.bytes);
});

test("a generation without metadata is unusable", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  store.files.delete(generationFile(1, "meta.json"));
  equal(selectRecovery(store, { gameId: GAME }, validate), null);
});

test("a stale pointer is repaired to the newest valid generation", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  const newest = candidate(6);
  promoted(store, newest);
  store.files.set(pointerPath(), utf8Encode(JSON.stringify({ version: 1, gameId: GAME, generation: 2, tick: 999, ledgerHash: "hash-999" })));

  const recovery = selected(store);
  equal(recovery.generation, 2);
  deepEqual(recovery.bytes, newest.bytes);
  deepEqual(pointerOf(store), { version: 1, gameId: GAME, generation: 2, tick: 6, ledgerHash: "hash-6" });
});

test("an unreadable pointed candidate falls back without demoting the pointer", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  promoted(store, candidate(6));
  store.readOverride = (path) => {
    if (path === generationFile(2, "candidate.bin")) throw new Error("candidate read failed");
    return undefined;
  };

  const recovery = selected(store);
  equal(recovery.generation, 1);
  deepEqual(recovery.bytes, previous.bytes);
  store.readOverride = null;
  equal(pointerOf(store).generation, 2);

  // The same generation being genuinely corrupt (a readable but invalid candidate) does repair.
  store.files.set(generationFile(2, "candidate.bin"), candidate(6, "hash-6", true).bytes);
  equal(selected(store).generation, 1);
  equal(pointerOf(store).generation, 1);
});

test("an unreadable pointed metadata falls back without demoting the pointer", () => {
  const store = new MemoryStore();
  const previous = candidate(5);
  promoted(store, previous);
  promoted(store, candidate(6));
  store.readOverride = (path) => {
    if (path === generationFile(2, "meta.json")) throw new Error("metadata read failed");
    return undefined;
  };

  const recovery = selected(store);
  equal(recovery.generation, 1);
  deepEqual(recovery.bytes, previous.bytes);
  store.readOverride = null;
  equal(pointerOf(store).generation, 2);
});

test("a throwing pointer read selects a fallback without repairing the pointer", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  promoted(store, candidate(6));
  store.files.set(pointerPath(), utf8Encode(JSON.stringify({ version: 1, gameId: GAME, generation: 1, tick: 5, ledgerHash: "hash-5" })));
  store.readOverride = (path) => {
    if (path === pointerPath()) throw new Error("pointer read failed");
    return undefined;
  };

  equal(selected(store).generation, 2);
  store.readOverride = null;
  equal(pointerOf(store).generation, 1);
});

test("an unreadable newer generation during a scan prevents pointer repair", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  promoted(store, candidate(6));
  promoted(store, candidate(7));
  const corruptPointer = utf8Encode("{ not a pointer");
  store.files.set(pointerPath(), corruptPointer);
  store.readOverride = (path) => {
    if (path === generationFile(3, "candidate.bin")) throw new Error("candidate read failed");
    return undefined;
  };

  equal(selected(store).generation, 2);
  store.readOverride = null;
  deepEqual(store.read(pointerPath()), corruptPointer);
});

test("promotion retains the current and one previous generation", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  promoted(store, candidate(6));
  promoted(store, candidate(7));

  deepEqual(generationsIn(store), [2, 3]);
  ok(store.read(generationFile(1, "candidate.bin")) === null);
  ok(store.read(generationFile(1, "meta.json")) === null);
  ok(store.read(generationFile(2, "candidate.bin")) !== null);
  ok(store.read(generationFile(3, "candidate.bin")) !== null);
  equal(selected(store).generation, 3);
});

test("pruning keeps the newest validated generation after a failed pointer switch", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  let interrupted = false;
  store.beforeAtomicWrite = () => {
    if (interrupted) return;
    interrupted = true;
    throw new Error("pointer write interrupted");
  };
  equal(failureMessage(() => promoted(store, candidate(6))), "pointer write interrupted");
  store.beforeAtomicWrite = null;
  // The old pointer generation is now unreadable; the validated generation from
  // the failed pointer switch must not be pruned in its favour.
  store.files.delete(generationFile(1, "candidate.bin"));

  promoted(store, candidate(7));
  deepEqual(generationsIn(store), [2, 3]);
});

test("pruning skips a corrupt newer generation and keeps a valid older one", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  promoted(store, candidate(6));
  store.files.set(generationFile(2, "candidate.bin"), candidate(6, "hash-6", true).bytes);

  promoted(store, candidate(7));
  deepEqual(generationsIn(store), [1, 3]);

  // Generation 1 is the real fallback when the promoted generation later fails.
  store.files.set(generationFile(3, "candidate.bin"), candidate(7, "hash-7", true).bytes);
  const recovery = selected(store);
  equal(recovery.generation, 1);
  equal(recovery.tick, 5);
  equal(pointerOf(store).generation, 1);
});

test("pruning keeps the newest remaining generation when none revalidates", () => {
  const store = new MemoryStore();
  promoted(store, candidate(5));
  store.files.delete(generationFile(1, "candidate.bin"));

  promoted(store, candidate(6));
  deepEqual(generationsIn(store), [1, 2]);
});

test("a host without removal keeps older generations and still selects safely", () => {
  const store = new MemoryStore();
  const host = withoutRemove(store);
  promoted(host, candidate(5));
  promoted(host, candidate(6));

  deepEqual(generationsIn(store), [1, 2]);
  equal(selected(host).generation, 2);
});

test("different games keep separate pointers and generations", () => {
  const store = new MemoryStore();
  const other = "fedcba9876543210";
  promoted(store, candidate(5));
  promoteRecovery(store, { gameId: other, bytes: candidate(50).bytes }, validate);

  equal(selected(store).generation, 1);
  equal(selected(store).tick, 5);
  equal(selected(store, other).generation, 1);
  equal(selected(store, other).tick, 50);
  equal(pointerOf(store, other).gameId, other);
});

test("a game id that would escape its path scope is refused", () => {
  const store = new MemoryStore();
  for (const gameId of ["", ".", "..", "a/b", "a\\b"]) {
    equal(failureCode(() => selectRecovery(store, { gameId }, validate)), "recovery.game-id");
  }
});

test("a v3 ledger checkpoint remains selectable and can be promoted with its v4 hash", () => {
  const store = new MemoryStore();
  const ledger = projectGameLedger(createGameState({ seed: 73 }));
  // Independently computed from the v3 canonical envelope, before world.movement existed.
  const oldHash = "596ec4f36ec70a9a";
  const currentHash = hashGameLedger(ledger);
  const bytes = utf8Encode(JSON.stringify({ tick: 73 }));
  const validateVersions: RecoveryValidate = (candidateBytes) => {
    const parsed = JSON.parse(utf8Decode(candidateBytes)) as { tick?: unknown };
    if (parsed.tick !== 73) throw new Error("candidate shape");
    return { tick: parsed.tick, ledgerHash: hashGameLedger(ledger), compatibleLedgerHashes: [hashGameLedgerV3(ledger)] };
  };

  store.write(generationFile(1, "candidate.bin"), bytes);
  store.write(generationFile(1, "meta.json"), utf8Encode(JSON.stringify({
    version: 1, generation: 1, tick: 73, ledgerHash: oldHash,
  })));
  store.writeAtomic(pointerPath(), utf8Encode(JSON.stringify({
    version: 1, gameId: GAME, generation: 1, tick: 73, ledgerHash: oldHash,
  })));

  const old = selectRecovery(store, { gameId: GAME }, validateVersions);
  ok(old !== null);
  equal(old.generation, 1);
  equal(old.ledgerHash, oldHash);

  const promotedV4 = promoteRecovery(store, { gameId: GAME, bytes: old.bytes }, validateVersions);
  equal(promotedV4.generation, 2);
  equal(promotedV4.ledgerHash, currentHash);
  equal(readJson(store, generationFile(2, "meta.json")).ledgerHash, currentHash);
  const selectedV4 = selectRecovery(store, { gameId: GAME }, validateVersions);
  ok(selectedV4 !== null);
  equal(selectedV4.generation, 2);
  equal(selectedV4.ledgerHash, currentHash);
  ok(store.files.has(generationFile(1, "candidate.bin")), "the prior v3 checkpoint remains retained as fallback");
});
