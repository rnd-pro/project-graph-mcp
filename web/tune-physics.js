#!/usr/bin/env node
/**
 * Physics oscillation analyzer — samples 10s post-settling to detect
 * vibration frequency, amplitude, and nearest-neighbor distance.
 * Compares raw (physics) vs smooth (rendered) positions.
 */
import puppeteer from 'puppeteer';

const URL = 'http://project-graph.local/test-force-sim.html';
const SETTLE_WAIT = 15000;
const SAMPLE_DURATION = 10000;
const SAMPLE_INTERVAL = 100;

async function getPositions(page) {
  return page.evaluate(() => {
    const smooth = {}, raw = {};
    for (const [id, pos] of smoothPositions) smooth[id] = { x: pos.x, y: pos.y };
    for (const [id, pos] of nodePositions)   raw[id] = { x: pos.x, y: pos.y };
    return { smooth, raw };
  });
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const txt = (id) => document.getElementById(id)?.textContent || '0';
    return {
      fps: parseInt(txt('fps')), tps: parseInt(txt('tps')),
      alpha: parseFloat(txt('alpha')),
      velAvg: parseFloat(txt('velAvg')), velMax: parseFloat(txt('velMax')),
      overlaps: parseInt(txt('overlaps')), spread: parseInt(txt('spread')),
      linkStretch: parseFloat(txt('linkStretch')),
      health: txt('healthVerdict'), nodeCount: parseInt(txt('nodeCount')),
    };
  });
}

async function getParams(page) {
  return page.evaluate(() => typeof params !== 'undefined' ? JSON.parse(JSON.stringify(params)) : {});
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function analyzeTrajectories(samples, key) {
  const nodeIds = Object.keys(samples[0][key]);
  const duration = SAMPLE_DURATION / 1000;
  const stats = {};
  
  for (const id of nodeIds) {
    const traj = samples.map(s => s[key][id]).filter(Boolean);
    if (traj.length < 10) continue;
    
    let dirX = 0, dirY = 0;
    for (let i = 2; i < traj.length; i++) {
      if ((traj[i-1].x - traj[i-2].x) * (traj[i].x - traj[i-1].x) < 0) dirX++;
      if ((traj[i-1].y - traj[i-2].y) * (traj[i].y - traj[i-1].y) < 0) dirY++;
    }
    const freq = (dirX + dirY) / 2 / duration;
    
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const p of traj) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const amp = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2);
    const meanX = traj.reduce((s,p)=>s+p.x,0)/traj.length;
    const meanY = traj.reduce((s,p)=>s+p.y,0)/traj.length;
    
    stats[id] = { freq, amp, meanX, meanY };
  }
  
  // NN distances from mean positions
  const ids = Object.keys(stats);
  const nn = [];
  for (let i = 0; i < ids.length; i++) {
    let min = Infinity;
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const d = Math.sqrt((stats[ids[i]].meanX - stats[ids[j]].meanX)**2 + (stats[ids[i]].meanY - stats[ids[j]].meanY)**2);
      if (d < min) min = d;
    }
    nn.push(min);
  }
  
  const freqs = Object.values(stats).map(s=>s.freq);
  const amps = Object.values(stats).map(s=>s.amp);
  
  return {
    avgFreq: freqs.reduce((s,v)=>s+v,0)/freqs.length,
    maxFreq: Math.max(...freqs),
    avgAmp: amps.reduce((s,v)=>s+v,0)/amps.length,
    maxAmp: Math.max(...amps),
    avgNN: nn.reduce((s,v)=>s+v,0)/nn.length,
    minNN: Math.min(...nn),
    nnDist: nn,
    freqs, amps,
    vibrating: Object.entries(stats).filter(([,s])=>s.freq>3 && s.amp<20).length,
  };
}

function printReport(label, r) {
  console.log(`\n── ${label} ──`);
  console.log(`  Oscillation: avg=${r.avgFreq.toFixed(1)}Hz max=${r.maxFreq.toFixed(1)}Hz  ${r.avgFreq > 5 ? '🔴' : r.avgFreq > 2 ? '🟡' : '🟢'}`);
  console.log(`  Amplitude:   avg=${r.avgAmp.toFixed(1)}px max=${r.maxAmp.toFixed(1)}px  ${r.avgAmp > 30 ? '🔴' : '🟢'}`);
  console.log(`  NN distance: avg=${r.avgNN.toFixed(1)}px min=${r.minNN.toFixed(1)}px  ${r.minNN < 15 ? '🔴' : r.minNN < 30 ? '🟡' : '🟢'}`);
  console.log(`  Vibrating:   ${r.vibrating} nodes`);
  
  // NN distribution
  const buckets = [0,5,10,20,40,80,150,300];
  const counts = buckets.slice(0,-1).map((_,i)=> r.nnDist.filter(d=>d>=buckets[i]&&d<buckets[i+1]).length);
  console.log(`  NN dist: ${buckets.slice(0,-1).map((b,i)=>`${b}-${buckets[i+1]}:${counts[i]}`).join(' | ')}`);
}

async function run() {
  console.log('🔬 Oscillation Analyzer v2 (raw vs smooth comparison)\n');
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  
  console.log('📦 Loading real graph...');
  await page.click('#btnRealGraph');
  console.log(`⏳ Settling ${SETTLE_WAIT/1000}s...`);
  await sleep(SETTLE_WAIT);

  const m = await readMetrics(page);
  console.log(`  Pre-state: ${m.health} | vel=${m.velAvg}/${m.velMax} | spread=${m.spread}`);

  console.log(`\n📊 Sampling ${SAMPLE_DURATION/1000}s at ${1000/SAMPLE_INTERVAL}Hz...`);
  const samples = [];
  for (let i = 0; i < SAMPLE_DURATION / SAMPLE_INTERVAL; i++) {
    samples.push(await getPositions(page));
    await sleep(SAMPLE_INTERVAL);
  }
  console.log(`  ${samples.length} samples, ${Object.keys(samples[0].smooth).length} nodes`);

  // Analyze both layers
  const rawReport = analyzeTrajectories(samples, 'raw');
  const smoothReport = analyzeTrajectories(samples, 'smooth');

  console.log('\n═══════════════════════════════════════');
  console.log('       OSCILLATION ANALYSIS REPORT');
  console.log('═══════════════════════════════════════');
  
  printReport('RAW (physics engine)', rawReport);
  printReport('SMOOTH (rendered, lerp)', smoothReport);

  // Summary
  console.log('\n═══ DIAGNOSIS ═══');
  const issues = [];
  if (rawReport.avgFreq > 3) issues.push('⚡ Physics oscillating at ' + rawReport.avgFreq.toFixed(1) + 'Hz — nodes bouncing');
  if (rawReport.avgAmp > 30) issues.push('🌊 Large physics swings: ' + rawReport.avgAmp.toFixed(0) + 'px');
  if (rawReport.minNN < 15) issues.push('📐 Nodes too close: min NN=' + rawReport.minNN.toFixed(1) + 'px — increase chargeStrength');
  if (smoothReport.avgFreq > 2 && rawReport.avgFreq < 2) issues.push('🔄 Smooth layer introduces oscillation — increase smoothing');
  if (smoothReport.minNN < rawReport.minNN * 0.5) issues.push('🎯 Smoothing collapses distances — reduce smoothing');
  
  if (issues.length === 0) console.log('  ✅ Graph is STABLE');
  else for (const i of issues) console.log(`  ${i}`);

  const p = await getParams(page);
  console.log('\n📋 Params:', JSON.stringify(p));
  await browser.close();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
