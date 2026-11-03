/**
 * Where an active `CallShop` session's stock lives while a menu provider presents it
 * (docs/spec/engine/rpgcode-functions.md#e-83, docs/spec/engine/plugins-and-battle.md#e-80-stock-menu).
 *
 * A presenting provider is an ordinary frame on the calling thread, or a native continuation parked on that
 * thread, so its screen identity and its saved plain-data continuation travel with the thread table (G1): no
 * `GameState` section and no save field is added, and a restore reconstitutes the stock from the session that
 * is still running.
 */
import type { PlainData } from "../ports/plain-data.ts";
import type { Thread } from "../script/state.ts";

/** The canonical screen token a shop presenter registers under. */
export const SHOP_SCREEN = "shop";

/** The ordered sources a provider continuation records, or `null` when it is not a shop's continuation. */
function stockOf(continuation: PlainData | undefined): readonly string[] | null {
  if (continuation === undefined || continuation === null) return null;
  if (typeof continuation !== "object" || Array.isArray(continuation)) return null;
  if (continuation["screen"] !== SHOP_SCREEN || !("stock" in continuation)) return null;
  const stock = continuation["stock"];
  if (!Array.isArray(stock)) return null;
  const sources = stock.filter((source): source is string => typeof source === "string");
  return sources.length === stock.length ? sources : null;
}

/**
 * The stock of the shop session a provider is presenting, or `null` when no shop screen is open.
 *
 * The innermost matching session wins: a provider may open a nested shop, and that session is the one its own
 * screens operate. A running RPGCode presenter records it on its top frame and a parked native presenter on
 * its wait continuation. Every part of this is plain data, so a restored session reads like a live one.
 */
export function shopStockFromThreads(threads: readonly Thread[]): readonly string[] | null {
  let found: readonly string[] | null = null;
  for (const thread of threads) {
    // A presenter's screens call the package's own functions, so the shop frame is anywhere in its stack.
    for (const frame of thread.frames) {
      const fromFrame = stockOf(frame.menuContinuation);
      if (fromFrame !== null) found = fromFrame;
    }
    const wait = thread.wait;
    if (wait?.kind === "menu.screen") {
      const fromWait = stockOf(wait.payload[0]);
      if (fromWait !== null) found = fromWait;
    }
  }
  return found;
}
