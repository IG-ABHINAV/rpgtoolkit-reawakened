// The TK-16 generator is deterministic and its output is what is committed (issue #1074: "two runs must produce
// identical bytes"). The check is a full rebuild compared byte for byte with media/soundfonts and the provenance
// record, so it also fails if someone edits the generator and forgets to rebuild.
//
// Duration: about 1.2 s (python start-up plus building three banks). A faster test would miss the point: only a real
// rebuild can show that the bytes on disk are what the generator makes, on this machine's maths library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const soundfonts = join(repoRoot, "media", "soundfonts");

test("rebuilding TK-16 reproduces the committed banks and provenance record byte for byte", () => {
  const out = mkdtempSync(join(tmpdir(), "tk16-rebuild-"));
  try {
    const run = spawnSync("python3", [join(repoRoot, "tools", "licences", "tk16_build.py"), "--out", out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    const committed = readdirSync(soundfonts).filter((name) => name.endsWith(".sf2")).sort();
    const rebuilt = readdirSync(out).filter((name) => name.endsWith(".sf2")).sort();
    assert.deepEqual(rebuilt, committed, "the generator makes exactly the banks that are committed");
    assert.ok(committed.length >= 3);
    for (const name of committed) {
      assert.ok(readFileSync(join(out, name)).equals(readFileSync(join(soundfonts, name))), `${name} is what the generator makes`);
    }

    const record = readFileSync(join(out, "tk16-provenance.json"), "utf8");
    assert.equal(record, readFileSync(join(repoRoot, "tools", "licences", "tk16-provenance.json"), "utf8"), "the provenance record is current");
    for (const bank of JSON.parse(record).banks) {
      const digest = createHash("sha256").update(readFileSync(join(repoRoot, bank.file))).digest("hex");
      assert.equal(bank.sha256, digest, `${bank.file} matches the hash in its provenance record`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
