import puppeteer from 'puppeteer';
const URL = 'http://project-graph.local/test-force-sim.html';
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.goto(URL);
console.log('Waiting 15s...');
await new Promise(r => setTimeout(r, 15000));
const stats = await page.evaluate(() => {
  return {
    fps: document.getElementById('fps').textContent,
    tps: document.getElementById('tps').textContent,
    alpha: document.getElementById('alpha').textContent,
    velAvg: document.getElementById('velAvg').textContent,
    energy: typeof worker !== 'undefined' ? 'not exposed' : '?',
    overlaps: document.getElementById('overlaps').textContent
  };
});
console.log('Stats after 15s:', stats);
await browser.close();
