import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  readMainFile,
  writeDistributionPackage,
  writeMainFile,
} from "@tk-reawakened/core";

export type QuitBatchFixture = {
  readonly name: string;
  readonly packageBytes: Uint8Array;
  readonly descriptor: Record<string, unknown>;
};

export function createQuitBatchFixture(name: string): QuitBatchFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const main = files.find((file) => file.path === manifest.value.main);
  if (main === undefined) throw new Error(`the demo package has no ${manifest.value.main}`);
  const parsed = readMainFile(new BinaryReader(main.bytes, main.path));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const startup = "quit-batch-start.prg";
  const pendingAssetProgram = "quit-batch-asset.prg";
  const rewritten = writeMainFile({ ...parsed.value, startupPrg: startup });
  if (!rewritten.ok) throw new Error(rewritten.error.message);
  const image = files.find((file) => /\.(bmp|png|jpe?g)$/i.test(file.path));
  if (image === undefined) throw new Error("the demo package has no bitmap image to use as the pending test asset");
  const suffix = image.path.slice(image.path.lastIndexOf("."));
  const pendingAsset = `quit-pending${suffix}`;
  const tree = [
    ...files.map((file) => file.path === main.path ? { path: file.path, bytes: rewritten.value } : file),
    { path: `Prg/${startup}`, bytes: new TextEncoder().encode(`assetName = \"${pendingAsset}\"\nWaitInput()\nThread(\"${pendingAssetProgram}\", true)\nQuitGame()\nEnd()\n`) },
    { path: `Prg/${pendingAssetProgram}`, bytes: new TextEncoder().encode(`Bitmap(assetName)\nEnd()\n`) },
    { path: `Bitmap/${pendingAsset}`, bytes: image.bytes },
  ];
  const packaged = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main: manifest.value.main, index: tree.map((file) => file.path) } });
  if (!packaged.ok) throw new Error(packaged.error.message);
  const identity = derivePackageIdentity(tree);
  return {
    name,
    packageBytes: packaged.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(packaged.value).digest("hex"),
      size: packaged.value.length,
      gameId: deriveGameId(rewritten.value, identity),
      title: "Quit batch probe",
      version: "1",
    },
  };
}
