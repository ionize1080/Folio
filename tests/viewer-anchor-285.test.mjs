import test from 'node:test';
import assert from 'node:assert/strict';
import { PageSurface } from '../src/viewer.mjs';

test('zoom anchor selects the nearest page across covers, foldouts and mixed page sizes', async () => {
  const pages = Array.from({length: 64}, (_, i) => ({
    box: i === 0 ? {width: 2400, height: 4200} :
      {width: i % 7 === 0 ? 860 : 140, height: i % 4 === 0 ? 340 : 95},
    rotation: i % 9 === 0 ? 90 : 0,
  }));
  const host = {clientWidth: 900, clientHeight: 700, scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({left: 0, top: 0})};
  const previousDpr = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, value: 1});
  try {
    for (const layout of ['continuous', 'two-continuous', 'horizontal', 'single', 'two']) {
      for (const cover of [true, false]) {
        const surface = Object.assign(Object.create(PageSurface.prototype), {
          host, layout, cover, gaps: true, viewRotation: 0, settings: {},
          stage: {style: {}}, entries: new Map(), fallback: new Map(),
          s: {pdf: {}, page: 32, zoom: '1', rotation: {}, info: {pages, pageCount: pages.length}},
        });
        await surface.refresh(null, false);
        for (const box of surface.boxes) {
          for (const [x, y] of [[box.x + box.w / 2, box.y + box.h / 2],
            [box.x - 9, box.y - 8], [box.x + box.w + 28, box.y + box.h]]) {
            const nearest = surface.boxes.reduce((best, candidate) =>
              surface.distance(candidate, x, y) < surface.distance(best, x, y) ? candidate : best);
            assert.equal(surface.capture(x, y).page, nearest.page, layout + ' page ' + box.page);
          }
        }
      }
    }
  } finally {
    if (previousDpr) Object.defineProperty(globalThis, 'devicePixelRatio', previousDpr);
    else delete globalThis.devicePixelRatio;
  }
});
