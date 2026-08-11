// Runs eve's own server and the non-eve runtime-core server side by side in
// the same container — two independent processes, two ports, same task.
// Plain child_process instead of a shell script: alpine's default shell
// (busybox ash) doesn't support bash's `wait -n`, and this needs no other
// shell feature, so a few lines of Node avoids the compatibility question
// entirely. If either process dies, kill the other and exit non-zero so
// ECS's own health check / circuit breaker notices and restarts the task,
// rather than silently running with only one half up.
import { spawn } from "node:child_process";

const eve = spawn("node", [".output/server/index.mjs"], { stdio: "inherit" });
const runtimeCore = spawn("node", ["--import", "tsx", "runtime-core/server.ts"], { stdio: "inherit" });

function exitBoth(code) {
  eve.kill();
  runtimeCore.kill();
  process.exit(code ?? 1);
}

eve.on("exit", (code) => exitBoth(code));
runtimeCore.on("exit", (code) => exitBoth(code));
