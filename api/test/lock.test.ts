import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, lockHolder } from '../src/db/lock.js';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'splus-lock-')), 'pg.lock');

describe('PGlite lock', () => {
  it('takes and releases a free lock', async () => {
    const f = tmp();
    const release = await acquireLock(f);
    expect(existsSync(f)).toBe(true);
    release();
    expect(existsSync(f)).toBe(false);
  });

  it('ignores a stale lock from a dead process', async () => {
    const f = tmp();
    writeFileSync(f, '999999');
    expect(lockHolder(f)).toBeNull();
    (await acquireLock(f))();
  });

  it('waits for a live holder to exit', async () => {
    const f = tmp();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600)']);
    writeFileSync(f, String(child.pid));
    expect(lockHolder(f)).toBe(child.pid);
    const start = Date.now();
    const release = await acquireLock(f, 5_000, 50);
    expect(Date.now() - start).toBeGreaterThan(300);
    release();
  });

  it('gives up with a clear message', async () => {
    const f = tmp();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
    writeFileSync(f, String(child.pid));
    await expect(acquireLock(f, 200, 50)).rejects.toThrow(/open in another process/);
    child.kill();
  });
});
