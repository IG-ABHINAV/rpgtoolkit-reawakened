/**
 * Dispatch the runner requests from one engine report in the order the contract requires.
 *
 * Prefetch hints are sent before blocking asset requests so a hint for the same key starts its origin read first and
 * the later blocking request joins it. Replies are still collected in report order, so input records stay in the order
 * the engine expects. Non-blocking, non-asset requests are answered in report order as well.
 */

import type { InputRecord, RunnerRequest } from "@tk-reawakened/core";

export async function dispatchRequests(
  requests: readonly RunnerRequest[],
  tick: number,
  hostReply: (request: RunnerRequest, tick: number) => Promise<InputRecord | null>,
): Promise<InputRecord[]> {
  const started: (Promise<InputRecord | null> | undefined)[] = requests.map((request) =>
    request.kind === "prefetch" ? hostReply(request, tick) : undefined
  );
  for (const [position, request] of requests.entries()) {
    if (request.kind === "asset") started[position] = hostReply(request, tick);
  }
  for (const answer of started) answer?.catch(() => undefined);
  const replies: InputRecord[] = [];
  for (const [position, request] of requests.entries()) {
    const reply = await (started[position] ?? hostReply(request, tick));
    if (reply !== null) replies.push(reply);
  }
  return replies;
}
