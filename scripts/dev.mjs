/**
 * `npm run dev`. Wraps `next dev` with two preflight checks and a lock.
 *
 * Both checks exist because the failure they prevent is a cryptic error followed by a dev
 * server that sits on "Starting…" and then dies. Neither is hypothetical — both states
 * happened while building this, and the second one twice.
 */
import { closeSync, existsSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Deliberately outside `.next`. The obvious home for this is `.next/dev.pid`, but `next dev`
 * prunes files it does not recognise from `.next` while booting, so the lock was gone by
 * the time the server was up — written, then silently swept away.
 */
const LOCK = ".dev.pid";

// ── 1. Is another dev server already using this `.next`? ──────────────────────
//
// Only one `next dev` can own a `.next` directory: it holds `.next/trace` open for
// writing. Next does not check for this. If port 3000 is taken it prints "using available
// port 3001 instead" and starts anyway, then dies with
//
//     Error: EPERM: operation not permitted, open '...\.next\trace'
//
// which names the symptom and not the cause. The port is the wrong thing to test — an
// unrelated process on 3000 is harmless and Next's fallback handles it correctly. What
// matters is whether *this directory* is taken.
//
// Two signals, because neither covers the other's case.

/** Is this pid a live process? */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else. Only ESRCH means gone.
    return err.code === "EPERM";
  }
}

/**
 * Signal A: a lockfile this script writes and holds for the server's lifetime.
 *
 * Deterministic, unlike signal B, and it answers before Next has done anything at all.
 * A stale file left by an abrupt kill is harmless — the pid simply is not alive any more.
 * Pid reuse could in principle make a stale file look live; the cost is one confusing
 * refusal cleared by deleting `.next/dev.pid`, which the message says.
 */
function lockHolder() {
  if (!existsSync(LOCK)) return null;
  const pid = Number.parseInt(readFileSync(LOCK, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || pid === process.pid) return null;
  return alive(pid) ? pid : null;
}

/**
 * Signal B: can we open the trace file the way Next will?
 *
 * Catches a server started outside this script — `npx next dev`, or an IDE run
 * configuration — which never wrote a lockfile. It is best-effort and misses one case: a
 * server that has just booted and not yet compiled anything has not opened its trace
 * stream, so there is nothing to collide with yet. Once open it stays open, so an
 * established server is always caught. Signal A is what covers the young one.
 *
 * Do not guard this with `existsSync`. That was the first version and it never fired: on
 * Windows, `stat` on a file held with restrictive sharing fails with EPERM, and
 * `existsSync` reports a failed stat as "false". A locked trace file therefore looks
 * *absent* — the one state worth detecting was the one state that skipped the check. The
 * open answers both questions at once; read the error code instead.
 *
 * Windows-only in practice. POSIX does not lock on open, and the failure is Windows-only
 * too, so falling through there is correct.
 */
function traceLocked() {
  try {
    closeSync(openSync(".next/trace", "a"));
    return false;
  } catch (err) {
    // Anything else — ENOENT when there is no `.next` yet, most commonly — means nothing
    // is in the way. A preflight check must never be the reason the dev server fails.
    return err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY";
  }
}

const holder = lockHolder();
if (holder !== null || traceLocked()) {
  console.error(
    [
      "Another dev server is already using .next in this directory.",
      "",
      "Only one `next dev` can run per project folder — a second one starts on port 3001",
      "and then dies trying to open .next/trace.",
      "",
      holder !== null
        ? `Stop it and try again:\n  taskkill /F /T /PID ${holder}      # or: kill ${holder}`
        : "Find it and stop it, then try again:\n  netstat -ano | findstr :3000\n  taskkill /F /T /PID <pid>",
      "",
      "If you are certain nothing is running, delete .dev.pid and retry.",
    ].join("\n"),
  );
  process.exit(1);
}

// ── 2. Is there a production build in the way? ────────────────────────────────
//
// `next dev` and `next build` share `.next`, and dev cannot start on top of a build's
// output: it walks `.next/static`, calls `readlink` on each entry, and a build leaves a
// real directory there named after the build id. `readlink` on a directory is EINVAL:
//
//     Error: EINVAL: invalid argument, readlink '...\.next\static\5LnGKULS5HRJuvl7LgSVi'
//
// A build always writes `.next/BUILD_ID`; dev never does. That file distinguishes the two
// states exactly, so the dev cache is only thrown away when it has to be — an
// unconditional wipe would force a full recompile on every `npm run dev`.
if (existsSync(".next/BUILD_ID")) {
  rmSync(".next", { recursive: true, force: true });
  console.log("Cleared a production build from .next so the dev server starts clean.");
}

// ── 3. Is OneDrive going to stall the watcher? ────────────────────────────────
//
// Inside a OneDrive-synced folder on Windows, `next dev` reaches "✓ Starting…" and then
// hangs indefinitely: the port opens and accepts connections, but `✓ Ready` never prints
// and no request ever returns. Measured on this project, the same code and the same
// node_modules, path being the only difference: 2 seconds to ready outside the synced
// tree, still nothing after 3 minutes inside it.
//
// Not Files On-Demand fetching anything — every file is already local. It is OneDrive's
// filter driver in front of every filesystem operation, and dev does tens of thousands of
// tiny ones. `next build` is unaffected because it makes one bounded pass; dev registers
// recursive watchers and keeps a webpack cache under `.next/cache`, so webpack's writes
// make OneDrive sync and OneDrive's writes fire the watchers again.
//
// A warning and not a refusal, deliberately. Unlike the two checks above this is not a
// certain failure — it depends on whether sync is currently paused, which there is no
// supported way to read — and a preflight check must never be the reason dev does not run.
if (process.env.OneDrive && process.cwd().startsWith(process.env.OneDrive)) {
  console.warn(
    [
      "Note: this project is inside a OneDrive-synced folder.",
      "If the server stops at \"Starting…\" and never becomes ready, pause syncing",
      "(tray icon -> Pause syncing) and start it again. See the README.",
      "",
    ].join("\n"),
  );
}

// ── Take the lock and hand over to Next ───────────────────────────────────────

writeFileSync(LOCK, String(process.pid));

let released = false;
function release() {
  if (released) return;
  released = true;
  try {
    unlinkSync(LOCK);
  } catch {
    // Already gone, or `.next` was wiped underneath us. Either way there is nothing to do.
  }
}
process.on("exit", release);

// `next` is invoked through this process's own node binary rather than the shim in
// node_modules/.bin, so there is no shell between us and it — the child stays a real child
// whose exit we can observe, and Ctrl+C reaches it directly.
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
});

// Ctrl+C already reaches the child, since it shares this console. Handling the signal here
// only stops *this* process from dying first and orphaning it; the child's exit is what
// ends us, so the lock is always released after the server is actually gone.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {});

child.on("exit", (code, signal) => {
  release();
  process.exit(signal ? 1 : (code ?? 0));
});

child.on("error", (err) => {
  release();
  console.error(`Could not start next dev: ${err.message}`);
  process.exit(1);
});
