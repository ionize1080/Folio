import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../file-store.cjs';

test('verified incremental save accepts metadata changes and rejects changed or replaced contents', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-file-version-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const original = Buffer.from('unchanged original');
  const delta = Buffer.from(' + revision');
  for (const change of ['metadata', 'content', 'replacement', 'deleted']) {
    const target = path.join(dir, change + '.pdf');
    await fs.writeFile(target, original);
    const store = new FileStore(() => { throw Error('Save should reuse the handle'); });
    const handle = store.grant(target, original);
    const ticket = await store.prepare({name:'source.pdf',kind:'pdf',handle,protect:false});
    if (change === 'metadata') await fs.utimes(target, new Date(1000), new Date(1000));
    if (change === 'content') await fs.writeFile(target, Buffer.alloc(original.length, 65));
    if (change === 'replacement') {
      // Keep the original inode alive to exercise equal bytes on a different file.
      await fs.rename(target, target + '.original');
      await fs.writeFile(target, original);
    }
    if (change === 'deleted') await fs.unlink(target);
    const bytes = change === 'deleted' ? null : await fs.readFile(target);
    const save = store.save({kind:'pdf', ticket, append:true, baseLength:original.length,
      baseHash:ticket.baseHash, bytes:delta});
    if (change === 'metadata') {
      assert.equal((await save).incremental,true);
      assert.deepEqual(await fs.readFile(target),Buffer.concat([original,delta]));
    } else {
      await assert.rejects(save, /其他程序|版本/);
      if (bytes) assert.deepEqual(await fs.readFile(target),bytes);
      else await assert.rejects(fs.stat(target), {code:'ENOENT'});
    }
  }
});
