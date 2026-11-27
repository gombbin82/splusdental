// One process per local PGlite folder. Two Postgres instances on the same files (e.g. `tsx watch`
// starting the new server before the old one has exited) can overwrite each other's writes.
// Same idea as kiwidental's src/db/lock.ts, plus waiting for a restarting process to let go.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** PID of another live process holding the lock, if any. */
export function lockHolder(lockFile: string): number | null {
  if (!existsSync(lockFile)) return null;
  const pid = Number(readFileSync(lockFile, 'utf8'));
  if (!pid || pid === process.pid || !alive(pid)) return null; // free, ours, or stale
  return pid;
}

/** Wait up to `timeoutMs` for another holder to exit, then take the lock. Returns a release fn. */
export async function acquireLock(
  lockFile: string,
  timeoutMs = 15_000,
  pollMs = 200,
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  for (let holder = lockHolder(lockFile); holder; holder = lockHolder(lockFile)) {
    if (Date.now() > deadline) {
      throw new Error(
        `The local database is open in another process (pid ${holder}). Stop it, then start again.`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  writeFileSync(lockFile, String(process.pid));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (readFileSync(lockFile, 'utf8') === String(process.pid)) rmSync(lockFile);
    } catch {
      // already gone
    }
  };
  process.once('exit', release);
  return release;
}
