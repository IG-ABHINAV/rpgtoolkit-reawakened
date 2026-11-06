import { shopStockFromThreads } from "../menu/shop.ts";
import type { Thread } from "../script/state.ts";

const CALL_SHOP_WAIT_ID = "callshop";

export type ShopSessionRuntime = {
  readonly stock: () => readonly string[];
  readonly setStock: (sources: readonly string[]) => boolean;
  readonly close: () => void;
  readonly reset: () => void;
};

/**
 * Engine-owned bridge between saveable CallShop sessions and the live menu session.
 *
 * A session is presented one of two ways (docs/spec/engine/rpgcode-functions.md#e-83): a registered `shop`
 * menu provider runs on the calling thread as an ordinary frame that carries the stock in its saved
 * continuation, or — with no presenter registered — the command waits on `menu.screen` and the ordered
 * stock rides in that wait's payload. Both are plain data, so a restore reconstitutes the stock without a
 * `GameState` field; `activeStock` only bridges the instant between activation and the frame or wait that
 * records it.
 */
export function createShopSessionRuntime(threads: () => readonly Thread[]): ShopSessionRuntime {
  let activeStock: string[] = [];
  const callShopWaiters = (): Thread[] => threads().filter((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === CALL_SHOP_WAIT_ID);
  return {
    stock() {
      const presented = shopStockFromThreads(threads());
      if (presented !== null) return presented;
      const waiters = callShopWaiters();
      if (waiters.length === 0) return activeStock;
      if (waiters.length !== 1) return [];
      const wait = waiters[0]?.wait;
      if (wait?.kind !== "menu.screen" || wait.id !== CALL_SHOP_WAIT_ID) return [];
      const payload: unknown = wait.payload[0];
      if (!Array.isArray(payload)) return [];
      const sources: string[] = [];
      for (const source of payload) {
        if (typeof source !== "string") return [];
        sources.push(source);
      }
      return sources;
    },
    setStock(sources) {
      if (sources.length > 0 && callShopWaiters().length > 0) return false;
      activeStock = [...sources];
      return true;
    },
    close() {
      activeStock = [];
      for (const waiter of callShopWaiters()) {
        if (waiter.wait?.kind === "menu.screen") waiter.wait.payload = [];
      }
    },
    reset() {
      activeStock = [];
    },
  };
}
