import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { IR_VERSION, startThread } from "../src/index.ts";
import { boot } from "./stock-menu-rig.ts";

test("a game save issued before quit is persisted and a save issued after quit is not", () => {
  const session = boot({
    startup: 'Save("before")\nQuitGame()\nSave("after")\nEnd()\n',
    persist: true,
  });
  const writes: string[] = [];
  const reportOrder: string[] = [];
  let quitAtTick = -1;
  for (let tick = 0; tick < 40; tick += 1) {
    const report = session.advance(1);
    for (const request of report.requests) {
      if (request.kind === "saveBlob") {
        writes.push(request.blob.path);
        reportOrder.push("saveBlob");
      } else if (request.kind === "quit") {
        reportOrder.push("quit");
        quitAtTick = tick;
      }
    }
    if (quitAtTick >= 0 && tick >= quitAtTick + 2) break;
  }
  deepEqual(reportOrder, ["saveBlob", "quit"], "the real engine reports the requested save before quit");
  equal(writes.length, 1, "only one game save reaches the host");
  equal(writes[0]?.endsWith("/saved/before.sav"), true);
  deepEqual(session.saves, writes);
  equal(
    session.state().vm.threads.some((thread) => thread.status === "waiting" && thread.wait?.kind === "blob"),
    false,
    "the post-quit Save is settled as failed rather than left waiting for the closed host",
  );
  deepEqual(
    session.state().vm.effects
      .filter((effect) => effect.kind === "request" && effect.name === "save")
      .map((effect) => effect.args[0]),
    ["before", "after"],
    "both save calls execute on opposite sides of quit",
  );
});
test("global host waits serialize file writes, game Save, and quit in a real engine session", () => {
  const session = boot({ startup: "end()\n", persist: true });
  const state = session.state();
  const thread = (text: string): void => {
    startThread(state.vm, { ref: { kind: "inline", text, ir: IR_VERSION }, kind: "board", owner: "script" });
  };
  thread('handle = openfileoutput("deferred.txt", "files")\nend()\n');
  thread('Save("before")\nend()\n');
  thread("QuitGame()\nend()\n");

  const reports: ReturnType<typeof session.advance>[] = [];
  for (let tick = 0; tick < 8 && !reports.some((report) => report.requests.some((request) => request.kind === "quit")); tick += 1) {
    reports.push(session.advance(1));
  }
  deepEqual(reports.map((report) => report.requests.map((request) => request.kind)), [["saveBlob"], ["saveBlob"], ["quit"]]);
  const fileWrite = reports[0]?.requests[0];
  const gameSave = reports[1]?.requests[0];
  ok(fileWrite?.kind === "saveBlob" && fileWrite.blob.path.endsWith("/files/deferred.txt"));
  ok(gameSave?.kind === "saveBlob" && gameSave.blob.path.endsWith("/saved/before.sav"));
  equal(session.saves.some((path) => path.endsWith("/saved/before.sav")), true, "the real host test rig receives the game save");
});

test("quit remains published when reset follows it in the same script turn", () => {
  const session = boot({ startup: "QuitGame()\nreset()\nEnd()\n" });
  const requestKinds: string[] = [];
  for (let tick = 0; tick < 20 && !requestKinds.includes("quit"); tick += 1) {
    requestKinds.push(...session.advance(1).requests.map((request) => request.kind));
  }
  equal(requestKinds.filter((kind) => kind === "quit").length, 1, "the latched quit reaches the host once");
});
