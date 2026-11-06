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
