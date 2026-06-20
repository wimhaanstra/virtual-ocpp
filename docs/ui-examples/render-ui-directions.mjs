import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, 'ui-directions.html');
const outputPath = resolve(__dirname, 'ui-directions.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlPath).href);
await page.screenshot({ path: outputPath, fullPage: true });
await browser.close();

console.log(outputPath);
