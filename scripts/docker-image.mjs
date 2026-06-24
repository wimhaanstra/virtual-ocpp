import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const command = process.argv[2];
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const image = process.env.DOCKER_IMAGE ?? 'wimhaanstra/virtual-ocpp';
const version = packageJson.version;

if (!version) {
  throw new Error('package.json does not contain a version');
}

const metadataArgs = [
  '--build-arg',
  `APP_VERSION=${version}`,
  '--build-arg',
  `VCS_REF=${gitRevision()}`,
  '--build-arg',
  `BUILD_DATE=${new Date().toISOString()}`
];

if (command === 'build') {
  await run('docker', ['build', ...metadataArgs, '-t', `${image}:latest`, '-t', `${image}:${version}`, '.']);
} else if (command === 'build:amd64') {
  await run('docker', [
    'buildx',
    'build',
    '--platform',
    'linux/amd64',
    ...metadataArgs,
    '-t',
    `${image}:${version}-amd64`,
    '--load',
    '.'
  ]);
} else if (command === 'publish') {
  await run('docker', [
    'buildx',
    'build',
    '--platform',
    'linux/amd64,linux/arm64',
    ...metadataArgs,
    '-t',
    `${image}:latest`,
    '-t',
    `${image}:${version}`,
    '--push',
    '.'
  ]);
} else {
  throw new Error('Usage: node scripts/docker-image.mjs <build|build:amd64|publish>');
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return 'unknown';
  }
  return result.stdout.trim() || 'unknown';
}

function run(executable, args) {
  console.log(`Running ${executable} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${executable} exited with code ${code}`));
      }
    });
  });
}
