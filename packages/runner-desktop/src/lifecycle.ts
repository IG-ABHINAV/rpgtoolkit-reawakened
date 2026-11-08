/**
 * The player's shutdown rule (entry 9.11).
 *
 * The player runs one game in one window, so closing that window ends the game, exactly as closing the engine's
 * window did ([E-06](../../../docs/spec/engine/main-loop-and-startup.md#e-06): "Exit (window closed …)"). Desktop
 * platforms disagree about what a closed window means: macOS keeps an application alive with no window, so the shell
 * would sit in the Dock with nothing to show while the process `pnpm desktop:run` started stayed attached to it, and
 * the next run would open a second copy. The player follows the game rather than the platform convention.
 *
 * The rule takes the Electron `app` object instead of importing Electron, so a test can prove it without a window, a
 * display or an Electron download.
 */

/** The part of Electron's `app` this rule uses. */
export interface PlayerApp {
  /** Subscribe to the event Electron raises once the last window has closed. */
  on(event: "window-all-closed", listener: () => void): unknown;
  /** Quit the application through Electron's ordered teardown. */
  quit(): void;
}

/**
 * Quit the application when its last window closes, on every platform including macOS.
 *
 * `app.quit()` rather than `app.exit()`: the teardown Electron orders (windows, then `will-quit`) still runs, so the
 * renderer's own `pagehide` disposal is asked to happen before the process ends.
 */
export function quitWhenLastWindowCloses(app: PlayerApp): void {
  app.on("window-all-closed", () => app.quit());
}

/** Quit the desktop player from a renderer-requested game quit using Electron's ordered teardown. */
export function quitPlayer(app: PlayerApp): void {
  app.quit();
}
