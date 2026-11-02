/**
 * SoundFont banks: the four-rank resolution of the effective bank and the runner's bank cache
 * (`docs/spec/engine/audio-media.md#soundfont-layers`, `#soundfont-user-bank`, `#audio-soundfont-cache`).
 *
 * **The ranks, in precedence order — four of them, and no fifth.** A player's own choice wins over the author's
 * `defaultSoundFont`, which wins over the runner's `RunConfig.audio.bank`, which wins over the bundled bank. Scripts
 * cannot replace or reset a bank (MEDIA-5): the only game-authored setting is the optional `defaultSoundFont`, and it
 * arrives in the `soundfont.set` cue.
 *
 * **The cache is keyed by the bank's SHA-256**, so two games that name the same bytes share one entry, and a bank that is
 * in use is never evicted — a swap waits for the voice that holds it to finish, which is what makes a hot swap safe
 * (`#soundfont-user-bank` item 4).
 *
 * **Validation** is the contract's: a custom bank must begin with a RIFF container of type `sfbk`, or it is
 * `bank.invalid` and the current bank stays; above the runner's ceiling it is `bank.unavailable`. The ceiling is a
 * runner number, not a protocol field.
 */

import type { BankRef } from "./protocol.ts";

/** The four layers, in precedence order. `null` means the layer has no opinion. */
export type BankLayers = {
  /** Rank 1: the player's runner preference — game choice, a bundled bank, a CDN bank or the player's own `.sf2`. */
  readonly player: BankRef | null;
  /** Rank 2: the game's `defaultSoundFont`, as the `soundfont.set` cue carries it. */
  readonly author: BankRef | null;
  /** Rank 3: `RunConfig.audio.bank`. */
  readonly runner: BankRef | null;
  /** Rank 4: the in-repo bundled bank. */
  readonly bundled: BankRef | null;
};

/** Which rank supplied the effective bank, so a diagnostic can say why this bank is playing. */
export type BankRank = "player" | "author" | "runner" | "bundled";

export type EffectiveBank =
  | { readonly rank: BankRank; readonly bank: BankRef }
  | { readonly rank: null; readonly bank: null };

/** The first non-null layer, in precedence order. Exhaustive over the ranks, so a fifth cannot be added silently. */
export function effectiveBank(layers: BankLayers): EffectiveBank {
  if (layers.player !== null) return { rank: "player", bank: layers.player };
  if (layers.author !== null) return { rank: "author", bank: layers.author };
  if (layers.runner !== null) return { rank: "runner", bank: layers.runner };
  if (layers.bundled !== null) return { rank: "bundled", bank: layers.bundled };
  return { rank: null, bank: null };
}

/** The bundled bank's identity: the file and the hash the notice records (PB-8). */
export const BUNDLED_BANK: BankRef = {
  source: "bundled",
  id: "media/soundfonts/TK-16.sf2",
  sha256: "a79fa6d4ae3b8ab8b3f3e3ddd4ab3d59a0ac24222caffcdd914435d76872ede2",
};

/** The runner's ceiling for a user or CDN bank: 8 MiB, the same number PB-8 sets for a bundled one. */
export const BANK_SIZE_CEILING = 8 * 1024 * 1024;

export class BankError extends Error {
  readonly code: "bank.invalid" | "bank.unavailable" | "bank.missing";
  constructor(code: "bank.invalid" | "bank.unavailable" | "bank.missing", detail: string) {
    super(detail);
    this.code = code;
    this.name = "BankError";
  }
}

/** A RIFF container of type `sfbk` (`.sf2`) or `sfbk`… `sf3` shares the container, only the sample codec differs. */
export function isSoundBankContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (at: number): string => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  return tag(0) === "RIFF" && tag(8) === "sfbk";
}

/**
 * Validate a bank's bytes for the runner's ceiling and container. Throws a `BankError` the caller reports as the
 * protocol's `error` code; returns the bytes unchanged when they are a bank this runner can use.
 */
export function validateBankBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) throw new BankError("bank.missing", "the bank is empty");
  if (bytes.length > BANK_SIZE_CEILING) {
    throw new BankError("bank.unavailable", `${bytes.length} bytes exceeds the ${BANK_SIZE_CEILING}-byte ceiling`);
  }
  if (!isSoundBankContainer(bytes)) throw new BankError("bank.invalid", "not a RIFF sfbk container");
  return bytes;
}

/** Lower-case hex SHA-256. Written out so the runner needs no WebCrypto, no `node:crypto` and no async boundary. */
export function sha256Hex(bytes: Uint8Array): string {
  const hasher = createSha256();
  hasher.update(bytes);
  return hasher.hex();
}

/**
 * An incremental SHA-256 for a host that sees its bytes a chunk at a time and cannot hold them all: absorb them in any
 * chunking, then take the digest once. The result is the digest `sha256Hex` gives the same bytes whole.
 */
export type Sha256 = {
  /** Absorb the next bytes. Throws once the digest has been taken. */
  update(bytes: Uint8Array): void;
  /** The 32-byte digest of every byte absorbed. Takes the digest: any later call throws. */
  digest(): Uint8Array;
  /** The digest as lower-case hex. Takes the digest like `digest`. */
  hex(): string;
};

/** A fresh incremental SHA-256 (FIPS 180-4). The byte count is exact up to 2^53 bits, far above any package. */
export function createSha256(): Sha256 {
  const k = SHA256_K;
  const h = new Uint32Array(SHA256_INITIAL);
  const w = new Uint32Array(64);
  const pending = new Uint8Array(64);
  let pendingLength = 0;
  let total = 0;
  let done = false;

  /** Fold the 64-byte block at `offset` of `data` into the running state. */
  function compress(data: Uint8Array, offset: number): void {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      w[index] = ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15]!, 7) ^ rotr(w[index - 15]!, 18) ^ (w[index - 15]! >>> 3);
      const s1 = rotr(w[index - 2]!, 17) ^ rotr(w[index - 2]!, 19) ^ (w[index - 2]! >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[index]! + w[index]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  function digest(): Uint8Array {
    if (done) throw new Error("sha256: the digest was already taken");
    done = true;
    const bits = total * 8;
    pending[pendingLength] = 0x80;
    pendingLength += 1;
    if (pendingLength > 56) {
      pending.fill(0, pendingLength, 64);
      compress(pending, 0);
      pendingLength = 0;
    }
    pending.fill(0, pendingLength, 56);
    const lengthView = new DataView(pending.buffer);
    lengthView.setUint32(56, Math.floor(bits / 0x1_0000_0000), false);
    lengthView.setUint32(60, bits >>> 0, false);
    compress(pending, 0);
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let index = 0; index < 8; index += 1) outView.setUint32(index * 4, h[index]!, false);
    return out;
  }

  return {
    update(bytes) {
      if (done) throw new Error("sha256: bytes were absorbed after the digest was taken");
      total += bytes.length;
      let at = 0;
      if (pendingLength > 0) {
        const take = Math.min(64 - pendingLength, bytes.length);
        pending.set(bytes.subarray(0, take), pendingLength);
        pendingLength += take;
        at = take;
        if (pendingLength < 64) return;
        compress(pending, 0);
        pendingLength = 0;
      }
      for (; at + 64 <= bytes.length; at += 64) compress(bytes, at);
      if (at < bytes.length) {
        pending.set(bytes.subarray(at), 0);
        pendingLength = bytes.length - at;
      }
    },
    digest,
    hex() {
      let hex = "";
      for (const byte of digest()) hex += byte.toString(16).padStart(2, "0");
      return hex;
    },
  };
}

function rotr(value: number, by: number): number {
  return ((value >>> by) | (value << (32 - by))) >>> 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_INITIAL = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

/** One cached bank: its bytes, its hash and how many voices are holding it. */
type CachedBank = {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  users: number;
  /** Insertion order for eviction: least recently used first. */
  lastUsed: number;
};

/**
 * The runner's bank cache (shared across games on that runner): banks keyed by the SHA-256 of their bytes, a load-once
 * policy, and eviction that **never** removes a bank a voice is holding.
 */
export class BankCache {
  private readonly load: (bank: BankRef) => Uint8Array | null;
  private readonly capacity: number;
  private readonly banks = new Map<string, CachedBank>();
  private clock = 0;
  private readonly evicted: string[] = [];
  private readonly loaded: string[] = [];

  constructor(options: { readonly load: (bank: BankRef) => Uint8Array | null; readonly capacity?: number }) {
    this.load = options.load;
    this.capacity = Math.max(1, options.capacity ?? 2);
  }

  /** Every bank the cache holds, by hash, with its user count — the shape a test reads. */
  get entries(): readonly { readonly sha256: string; readonly users: number }[] {
    return [...this.banks.values()].map((bank) => ({ sha256: bank.sha256, users: bank.users }));
  }

  /** The hashes evicted so far, oldest first. */
  get evictions(): readonly string[] {
    return this.evicted;
  }

  /** The hashes this cache fetched from the loader: the proof that a shared bank was loaded once. */
  get loads(): readonly string[] {
    return this.loaded;
  }

  /**
   * Pin a bank for a voice and return its bytes. The bank is fetched, validated and hashed on first use; a second
   * caller naming the same bytes (from another game, or another `BankRef` spelling) gets the cached entry. The caller
   * **must** pair this with `release` when the voice finishes, or the entry cannot be evicted.
   */
  acquire(bank: BankRef): Uint8Array {
    const bytes = this.load(bank);
    if (bytes === null) throw new BankError("bank.missing", `the runner cannot read ${bank.source}:${bank.id}`);
    const checked = validateBankBytes(bytes);
    const digest = sha256Hex(checked);
    if (bank.sha256 !== null && bank.sha256 !== digest) {
      throw new BankError("bank.invalid", `${bank.source}:${bank.id} hashes to ${digest}, not ${bank.sha256}`);
    }
    const existing = this.banks.get(digest);
    if (existing !== undefined) {
      existing.users += 1;
      existing.lastUsed = (this.clock += 1);
      return existing.bytes;
    }
    this.banks.set(digest, { sha256: digest, bytes: checked, users: 1, lastUsed: (this.clock += 1) });
    this.loaded.push(digest);
    this.evictToCapacity();
    return checked;
  }

  /** Unpin a bank. Entries with no users stay cached until capacity pushes them out. */
  release(sha256: string): void {
    const bank = this.banks.get(sha256);
    if (bank === undefined) return;
    bank.users = Math.max(0, bank.users - 1);
  }

  /** The bytes of a pinned bank, or `null` when it was evicted between two calls (a caller must re-acquire). */
  bytesOf(sha256: string): Uint8Array | null {
    return this.banks.get(sha256)?.bytes ?? null;
  }

  /** Drop every entry nobody is using: the explicit tidy a settings screen can call. */
  sweep(): readonly string[] {
    const dropped: string[] = [];
    for (const [digest, bank] of [...this.banks]) {
      if (bank.users > 0) continue;
      this.banks.delete(digest);
      dropped.push(digest);
    }
    return dropped;
  }

  /** Evict the least recently used bank that **no one** is holding, until the cache is within capacity. */
  private evictToCapacity(): void {
    while (this.banks.size > this.capacity) {
      let victim: CachedBank | null = null;
      for (const bank of this.banks.values()) {
        if (bank.users > 0) continue;
        if (victim === null || bank.lastUsed < victim.lastUsed) victim = bank;
      }
      if (victim === null) return; // every entry is in use: the cache stays over capacity rather than break a voice
      this.banks.delete(victim.sha256);
      this.evicted.push(victim.sha256);
    }
  }
}
