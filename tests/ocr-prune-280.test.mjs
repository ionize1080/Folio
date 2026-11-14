import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { OCRJobs } = createRequire(import.meta.url)('../ocr-jobs.cjs');

test('OCR pruning rechecks snapshot and job pins acquired during the asynchronous scan', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'folio-prune-'));
  const jobs = new OCRJobs(path.resolve('native'),dir,'python');
  const reference = '11111111-1111-1111-1111-111111111111', jobId = 'a'.repeat(64);
  const snapshot = path.join(jobs.store,'snapshots',reference+'.jsonl');
  const input = path.join(jobs.store,jobId,'input.pdf');
  try {
    for (const file of [snapshot,input]) {await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'preserve');}
    const stat = fs.stat;
    t.mock.method(fs,'stat',async file => {
      const value = await stat(file);
      if(file===snapshot) jobs.references.set(reference,snapshot);
      if(file===input) jobs.startingId=jobId;
      return value;
    });
    assert.equal((await jobs.prune(0)).removed,0);
    for(const file of [snapshot,input])assert.equal(await fs.readFile(file,'utf8'),'preserve');
    t.mock.restoreAll(); jobs.references.clear();jobs.startingId=null;
    assert.equal((await jobs.prune(0)).removed,16);
  } finally {t.mock.restoreAll();await fs.rm(dir,{recursive:true,force:true});}
});
