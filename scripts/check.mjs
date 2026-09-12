import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.mjs')) { const r = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (r.status) process.exitCode = 1; }
  }
}
for (const dir of ['src', 'bin', 'tests', 'scripts', 'skills']) check(dir);
