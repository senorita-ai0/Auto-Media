import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve('.automedia');
const file = path.join(dir, 'jobs.json');
const defaults = { version: 1, jobs: [], updatedAt: null };

async function read() {
  await fs.mkdir(dir, { recursive: true });
  try { return { ...defaults, ...JSON.parse(await fs.readFile(file, 'utf8')) }; }
  catch { return { ...defaults }; }
}
async function write(data) {
  await fs.mkdir(dir, { recursive: true });
  const out = { ...defaults, ...data, jobs: (data.jobs || []).slice(-1000), updatedAt: new Date().toISOString() };
  await fs.writeFile(file, JSON.stringify(out, null, 2));
  return out;
}
export async function createJob(meta={}) {
  const data=await read();
  const job={id:crypto.randomUUID(),status:'queued',attempt:0,maxAttempts:3,createdAt:new Date().toISOString(),...meta};
  data.jobs.push(job); await write(data); return job;
}
export async function updateJob(id, patch) {
  const data=await read(), i=data.jobs.findIndex(x=>x.id===id);
  if(i<0) return null;
  data.jobs[i]={...data.jobs[i],...patch,updatedAt:new Date().toISOString()};
  await write(data); return data.jobs[i];
}
export async function getJob(id){ return (await read()).jobs.find(x=>x.id===id)||null; }
export async function listJobs(limit=100){ return (await read()).jobs.slice(-Math.max(1,Number(limit)||100)).reverse(); }
export async function clearJobs(){ return write({...defaults,jobs:[]}); }

export function classifyError(error) {
  const m=String(error?.message||error||'').toLowerCase();
  if(/401|403|unauthori|forbidden|invalid.*credential|refresh token|permission/.test(m)) return {retryable:false,reason:'authentication_or_permission'};
  if(/400|invalid.*video|unsupported|bad request|no fresh|all videos|no supported video|no rss feeds|automation is paused|not active|failed schema validation|does not have a native runner/.test(m)) return {retryable:false,reason:'invalid_or_configured_request'};
  if(/429|rate.?limit|too many/.test(m)) return {retryable:true,reason:'rate_limited',delayMs:60000};
  if(/timeout|timed out|econn|network|fetch failed|socket|temporar|5\d\d/.test(m)) return {retryable:true,reason:'transient_network'};
  return {retryable:true,reason:'unknown'};
}
