import test from "node:test";
import assert from "node:assert/strict";
import {palettes,colors,contrast} from "../src/appearance.mjs";
test("accent and button text retain contrast across palettes, including extreme custom values",()=>{
  for(const name of [...Object.keys(palettes),"custom"]) {
    for(const custom of ["#ffffff","#000000","#ffff00","#00ff00","#777777","#0000ff"]) {
      for(const dark of [false,true]) {
        const {accent,ink,canvas}=colors(name,custom,dark);
        assert(contrast(ink,accent)>=4.5);
        assert(contrast(accent,canvas)>=4.5);
      }
    }
  }
});
test("default light palette preserves the specified cobalt",()=>{
  assert.equal(colors("cobalt",null,false).accent,"#165ddb");
});
