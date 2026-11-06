import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const window={};vm.runInNewContext(fs.readFileSync('integrations/chatbox/conversion-json.js','utf8'),{window});
test('extracts grounded JSON despite provider prose/fences, escaped quotes and braces',()=>{
 for(const prefix of ['', 'Extracted structure:\n','```json\n'])assert.equal(window.folioParseReview(prefix+'{"pages":[{"text":"a } \\\" b"}]}\n```').pages[0].text,'a } " b');
 assert.throws(()=>window.folioParseReview('No JSON available'));assert.throws(()=>window.folioParseReview('{"pages": [}'));
});
