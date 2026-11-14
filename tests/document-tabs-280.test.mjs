import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

function fixture() {
  let manager, sequence = 0;
  const views = [], events = [];
  class WC extends EventEmitter {
    constructor() { super(); this.id = ++sequence; }
    isDestroyed() { return !!this.destroyed; }
    async loadURL() { this.emit('did-start-navigation', {isMainFrame:true,isSameDocument:false}); manager.ready(this); }
    send(channel, value) { if (channel === 'tabs-request') this.receive?.(value); }
    close() { this.destroyed = true; this.emit('destroyed'); }
    reload() { this.loadURL(); }
    focus() { events.push(['focus', this.id]); }
    async capturePage() { events.push(['paint', this.id]); }
    setBackgroundThrottling() {}
  }
  class View {
    constructor() { this.webContents = new WC(); views.push(this); }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible() {}
  }
  class Host extends EventEmitter {
    constructor() { super(); this.webContents = new WC(); const children = [];
      this.contentView = {children, addChildView(v, i=children.length) {v.parent?.removeChildView(v); children.splice(i,0,v); v.parent=this;}, removeChildView(v) { const i=children.indexOf(v); if(i>=0)children.splice(i,1); v.parent=null; }};
    }
    getContentSize() { return [1200,800]; }
    setContentSize() {}
    destroy() { this.emit('closed'); }
  }
  const module = {exports:{}};
  const realRequire = createRequire(import.meta.url);
  vm.runInNewContext(fs.readFileSync(new URL('../document-tabs.cjs', import.meta.url),'utf8'), {
    module, require: name => name === 'electron' ? {WebContentsView:View,BaseWindow:Host} : realRequire(name), process,
  });
  const win = new Host();
  manager = new module.exports.DocumentTabs(win, {}, wc => {
    wc.receive = ({id,action}) => manager.reply(wc, {id,result:true});
  }, async file => ({name:file}));
  manager.ready(win.webContents);
  return {manager, win, views, events};
}

test('prepared documents swap only after load and paint, and duplicate opens reuse the editor', async () => {
  const {manager:m,win,views,events} = fixture();
  await m.open(['first.pdf']);
  let release;
  m.readFile = () => new Promise(resolve => {release=resolve;});
  const opening = m.open(['second.pdf']);
  assert.equal(m.active,m.home);
  assert.equal(win.contentView.children.length,0);
  assert.equal(m.snapshot().documents[1].loading,true);
  release({}); await opening;
  assert.equal(m.active.view,views[0]);
  assert.equal(win.contentView.children[0],views[0]);
  assert.deepEqual(events.map(e=>e[0]),['paint','focus']);
  await m.open(['second.pdf']);
  assert.equal(views.length,1);
  assert.equal(m.documents().length,2);
});

test('failed preparation preserves the previous document and frees its hidden view', async () => {
  const {manager:m,win,views} = fixture();
  await m.open(['first.pdf']);
  m.readFile = async () => {throw Error('invalid PDF');};
  await m.open(['broken.pdf']);
  assert.equal(m.active,m.home);
  assert.equal(m.documents().length,1);
  assert.equal(win.contentView.children.length,0);
  assert.equal(m.preparationWindow.contentView.children.length,0);
  assert(views[0].webContents.isDestroyed());
});

test('renderer destruction before ready rejects requests instead of blocking the operations queue', async () => {
  const {manager:m} = fixture();
  m.resetReady(m.home);
  const pending = m.enqueue(() => m.request(m.home,'load',{}));
  m.home.wc.close();
  await assert.rejects(pending,/process exited/);
  assert.equal(await m.enqueue(() => 42),42);
});

test('renderer crashes reject pending replies and a forged reply cannot resolve another document', async () => {
  const {manager:m} = fixture();
  let request;
  m.home.wc.receive = value => {request=value;};
  const pending = m.request(m.home,'load',{});
  await Promise.resolve();
  m.reply({}, {id:request.id,result:true});
  assert.equal(m.waiting.size,1);
  m.home.wc.emit('render-process-gone');
  await assert.rejects(pending,/process exited/);
  assert.equal(m.waiting.size,0);
});

test('navigation readiness only resets for main-frame cross-document navigation', () => {
  const {manager:m} = fixture();
  const before = m.home.initialized;
  m.home.wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});
  assert.equal(m.home.initialized,before);
  m.home.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});
  assert.equal(m.home.initialized,before);
  m.home.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
  assert.notEqual(m.home.initialized,before);
});
