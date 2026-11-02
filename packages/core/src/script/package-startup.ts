/**
 * Package start-up: the one run that establishes the layers a package registers
 * (MOD-4 lifecycle and point 3, PKG-5; entry 19.8;
 * docs/spec/engine/rpgcode-modules-and-objects.md#registerplugin-layers-entry-198).
 *
 * The owner rules that package layers are rebuilt at every start-up and are not
 * saved, so a host runs every package's start-up program, in manifest order, on a
 * fresh state before it uses the game: a new game does so on its own fresh state,
 * and a restore does so on a scratch fresh state and then loads the saved state,
 * keeping the layer table the start-up built. Start-up is deterministic and runs
 * on a fresh state both times, so it makes the same layer ids and the same closure
 * cells (`cell<n>`) both times, and the loaded state's cells and handles agree with
 * the rebuilt table.
 *
 * It runs the threads phase only, never the clock: a start-up program registers and
 * does not wait, so the clock does not move and a new game's state has no residue
 * of it but the cells, definition owners and variables the program made. The thread
 * is removed when it ends. A program that waits, or that has not finished after
 * `MAX_STARTUP_SLICES` slices of the step budget, stops the run with
 * `package.startup-unfinished`; it is a load-time failure, never catchable by a script.
 */

import type { GameState } from "../save/state.ts";
import { registerPackageBehaviours, resolveBehaviour } from "../actors/behaviour.ts";
import { restorePluginLayers, snapshotPluginLayers } from "./layers.ts";
import { beginPackageExport, sealPackageExport } from "./package-exports.ts";
import { foldNamespace } from "./manifest.ts";
import { ScriptError } from "./errors.ts";
import type { ProgramRef } from "./program.ts";
import { findThread, killThread, startProgram } from "./state.ts";
import type { ResolvedPlugin } from "./plugin.ts";
import { runThreadsPhase, STEP_BUDGET, threadLocation, type ScriptServices } from "./vm.ts";

/** The most budget-sized slices one start-up program may take before the run is refused. */
export const MAX_STARTUP_SLICES = 100;

/**
 * Run package startup contributions on a fresh session. Each package's
 * behaviour-startup callback receives a namespace-scoped registrar before its
 * RPGCode startup program runs. `state` must be a fresh state, `services` the
 * services made over it, and `plugins` the exact resolved package list.
 */
export function runPackageStartup(
  state: GameState,
  services: ScriptServices,
  startups: readonly ProgramRef[],
  plugins: readonly ResolvedPlugin[],
  listenersBeforeStartup?: readonly GameState["events"]["listeners"][number][],
): void {
  const listeners = [...(listenersBeforeStartup ?? services.listenersBeforePackageStartup)];
  const layers = snapshotPluginLayers(services.layers);
  const behaviours = services.behaviours.snapshot();
  const initialThreadIds = new Set(state.vm.threads.map((thread) => thread.id));
  let activeThread: number | undefined;
  try {
    registerPackageBehaviours(services.behaviours, plugins);
    for (const actor of state.actors.actors) resolveBehaviour(services.behaviours, actor, services.diagnostics);
    for (let startupIndex = 0; startupIndex < startups.length; startupIndex += 1) {
      const ref = startups[startupIndex]!;
      const matchedPlugin = plugins.find((plugin) => plugin.startup === ref);
      const packageName = ref.owner ?? matchedPlugin?.package?.name ?? matchedPlugin?.definition.id;
      const diagnosticStart = services.diagnostics.length;
      services.setPackageStartup(true, packageName);
      const owningPlugin = matchedPlugin ?? plugins.find((plugin) => (plugin.package?.name ?? plugin.definition.id) === packageName);
      const entry = packageName === undefined
        ? undefined
        : beginPackageExport(services.layers, packageName, owningPlugin?.namespace === undefined ? null : foldNamespace(owningPlugin.namespace), ref);
      const thread = startProgram(state.vm, ref);
      const id = thread.id;
      activeThread = id;
      for (let slice = 0; slice < MAX_STARTUP_SLICES; slice += 1) {
        runThreadsPhase(state.vm, services, STEP_BUDGET);
        const running = findThread(state.vm, id);
        if (running === undefined || running.status !== "ready") break;
      }
      const startupDiagnostic = services.diagnostics.slice(diagnosticStart).find((diagnostic) => diagnostic.code === "package.startup-forbidden" || diagnostic.code === "package.startup-unfinished");
      if (startupDiagnostic !== undefined) throw new ScriptError(startupDiagnostic.code, startupDiagnostic.message, { file: startupDiagnostic.file, line: startupDiagnostic.line });
      const last = findThread(state.vm, id);
      if (last !== undefined && last.status !== "finished") {
        const location = threadLocation(last, services) ?? { file: ref.kind === "file" ? ref.path : "<inline>", line: 0 };
        throw new ScriptError(
          "package.startup-unfinished",
          `a package start-up program ${last.status === "waiting" ? "waits" : "did not finish"}; start-up registers layers and neither waits nor runs on (PKG-5)`,
          location,
        );
      }
      if (killThread(state.vm, id)) services.onThreadRemoved?.(id);
      if (entry !== undefined) sealPackageExport(services.layers, entry, services);
      activeThread = undefined;
    }
  } catch (error) {
    for (const thread of [...state.vm.threads]) {
      if (killThread(state.vm, thread.id)) services.onThreadRemoved?.(thread.id);
    }
    if (activeThread !== undefined) {
      if (killThread(state.vm, activeThread)) services.onThreadRemoved?.(activeThread);
      activeThread = undefined;
    }
    restorePluginLayers(services.layers, layers);
    services.behaviours.restore(behaviours);
    state.events.listeners.splice(0, state.events.listeners.length, ...listeners);
    throw error;
  } finally {
    services.setPackageStartup(false);
  }
}
