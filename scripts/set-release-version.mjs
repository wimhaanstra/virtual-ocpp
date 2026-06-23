import { readFile, writeFile } from 'node:fs/promises';

const rootPackagePath = new URL('../package.json', import.meta.url);
const webPackagePath = new URL('../apps/web/package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);

const dateArg = process.argv.find((arg) => arg.startsWith('--date='));
const buildDate = dateArg?.slice('--date='.length) ?? new Date().toISOString().slice(0, 10).replaceAll('-', '');

if (!/^\d{8}$/.test(buildDate)) {
  throw new Error(`Release date must use YYYYMMDD format, received ${buildDate}`);
}

const rootPackage = await readJson(rootPackagePath);
const webPackage = await readJson(webPackagePath);
const lock = await readJson(lockPath);
const baseVersion = stripDatePrerelease(rootPackage.version);
const releaseVersion = `${baseVersion}-${buildDate}`;

rootPackage.version = releaseVersion;
webPackage.version = releaseVersion;
if (lock.version) lock.version = releaseVersion;
if (lock.packages?.['']) lock.packages[''].version = releaseVersion;
if (lock.packages?.['apps/web']) lock.packages['apps/web'].version = releaseVersion;

await writeJson(rootPackagePath, rootPackage);
await writeJson(webPackagePath, webPackage);
await writeJson(lockPath, lock);

console.log(`Release version set to ${releaseVersion}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stripDatePrerelease(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-\d{8})?$/);
  if (!match) {
    throw new Error(`Package version must be x.y.z or x.y.z-YYYYMMDD, received ${version}`);
  }
  return match[1];
}
