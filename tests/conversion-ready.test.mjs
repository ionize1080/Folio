import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('integrations/chatbox/conversion-review.ts','utf8').replace(/^import .*\r?\n/gm,'');
test('conversion waits for persisted model settings before constructing a provider',async()=>{
  let ready,settings={},calls=0;
  const hydration=new Promise(resolve=>ready=()=>{settings={defaultChatModel:{provider:'test',model:'model'}};resolve();});
  const window={folioParseReview:JSON.parse};
  vm.runInNewContext(source,{window,AbortSignal,settingsStore:{getState:()=>({getSettings:()=>settings})},initSettingsStore:()=>hydration,
    platform:{getConfig:async()=>({})},createModelDependencies:async()=>({}),getModel:choice=>{
      calls++;assert.equal(choice.provider,'test');return {chat:async()=>({contentParts:[{type:'text',text:'{"pages":[]}'}]})};
    }});
  const result=window.folioReviewConversion({kind:'office',pages:[]});
  await Promise.resolve();assert.equal(calls,0);ready();
  assert.equal((await result).pages.length,0);assert.equal(calls,1);assert.equal(await window.folioSettingsReady(),true);
});
test('an actually unconfigured model remains an explicit error after hydration',async()=>{
  const window={};vm.runInNewContext(source,{window,settingsStore:{getState:()=>({getSettings:()=>({})})},initSettingsStore:async()=>{}});
  await assert.rejects(window.folioReviewConversion({kind:'office',pages:[]}),/默认对话模型/);
});

test('Office conversion requests a grounded repair and rejects a second invalid review', async () => {
  const pages = [{page: 6, words: [{id: 'p6w0'}, {id: 'p6w1'}]}];
  const review = ids => ({pages: [{page: 6, tables: [{rows: 1, cols: 2,
    cells: ids.map((id, col) => ({row: 0, col, wordIds: [id]}))
  }]}]});
  for (const [wrong, reason] of [['p6w0', /reuses p6w0/], ['p5w0', /absent from the input page/]]) {
    for (const repaired of [true, false]) {
      const window = {folioParseReview: JSON.parse};
      let calls = 0;
      vm.runInNewContext(source, {window, AbortSignal, settingsStore: {getState: () => ({
        getSettings: () => ({defaultChatModel: {provider: 'test', model: 'test'}})
      })}, initSettingsStore: async () => {}, platform: {getConfig: async () => ({})},
      createModelDependencies: async () => ({}), getModel: () => ({chat: async messages => {
        calls++;
        if (calls === 2) assert.match(messages.at(-1).content, reason);
        const result = review(['p6w0', repaired && calls === 2 ? 'p6w1' : wrong]);
        return {contentParts: [{type: 'text', text: JSON.stringify(result)}]};
      }})});
      const result = window.folioReviewConversion({kind: 'office', pages});
      if (repaired) assert.deepEqual(await result, review(['p6w0', 'p6w1']));
      else await assert.rejects(result, /原文引用仍无效/);
      assert.equal(calls, 2);
    }
  }
});
