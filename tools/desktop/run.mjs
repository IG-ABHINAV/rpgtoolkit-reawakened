// Launch the built desktop player and leave it open (entry 9.11). This is the developer-facing "run the game" command:
//
//   pnpm desktop:run --package fixtures/packages/demo.tpk
//
// It builds the demo package when `--package` is absent (so `pnpm desktop:run` works after `pnpm fixtures:fetch` and
// `pnpm desktop:build`), and passes every flag through to the Electron main process in `runner-desktop`, which knows
// `--serve <dir>`, `--package <file.tpk>`, `--page <path>`, `--report <file>` and `--devtools`.
//
// It is the same launch `tools/desktop/measure.mjs` performs, minus the report file, so the window stays open. Closing
// that window quits the player (on every platform); this script then exits with it, so the game leaves no process
// behind.

import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { electronBinary } from "./electron-binary.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "packages", "runner-desktop", "dist");

/** The package to open: the one named by `--package`, or the demo package built from the fetched sample. */
function packagePath() {
  const at = process.argv.indexOf("--package");
  if (at >= 0) return resolve(process.argv[at + 1] ?? "");
  const out = join(root, "fixtures", "packages", "demo.tpk");
  execFileSync(
    process.execPath,
    [join(root, "tools", "make-package", "run.mjs"), join(root, "fixtures", "legacy", "demo"),
      "--closing-plan", join(root, "golden", "closing", "plan.json"), "--game", "demo", "--out", out, "--title", "Demo"],
    { cwd: root, stdio: "inherit" },
  );
  return out;
}

// The user's flags come first so the main process's `indexOf` sees them; defaults fill in only what was not passed.
const args = [dist, ...process.argv.slice(2)];
if (!process.argv.includes("--serve")) args.push("--serve", root);
if (!process.argv.includes("--page")) args.push("--page", "packages/runner-desktop/app/player.html");
if (!process.argv.includes("--package")) args.push("--package", packagePath());

const child = spawn(electronBinary(), args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    // The npm-installed Electron binary is user-owned, so the Linux SUID sandbox helper is not configured.
    // Disable sandboxing so `desktop:run` works out of the box on Linux; it can be overridden by setting the var externally.
    ...(process.platform === "linux" && process.env.ELECTRON_DISABLE_SANDBOX === undefined ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
