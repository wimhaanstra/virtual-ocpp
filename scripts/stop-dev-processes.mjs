import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: npm run dev:stop [-- --dry-run]

Stops Virtual OCPP development processes that reference this repository path.

Options:
  --dry-run   Show matching processes without stopping them.`);
  process.exit(0);
}

const dryRun = args.has('--dry-run');
const repoRoot = realpathSync(new URL('..', import.meta.url));
const currentPid = process.pid;
const psOutput = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });

const targets = psOutput
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) return null;
    return { pid: Number(match[1]), command: match[2] };
  })
  .filter((entry) => entry && entry.pid !== currentPid)
  .filter((entry) => {
    if (!entry.command.includes(repoRoot)) return false;
    return (
      entry.command.includes('src/index.ts') ||
      entry.command.includes('vite') ||
      entry.command.includes('tsx') ||
      entry.command.includes('npm run dev')
    );
  });

if (targets.length === 0) {
  console.log('No Virtual OCPP dev processes found.');
  process.exit(0);
}

for (const target of targets) {
  if (dryRun) {
    console.log(`Would stop PID ${target.pid}: ${target.command}`);
    continue;
  }

  try {
    process.kill(target.pid, 'SIGTERM');
    console.log(`Stopped PID ${target.pid}: ${target.command}`);
  } catch (error) {
    console.warn(`Could not stop PID ${target.pid}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
