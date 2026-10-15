import test from 'node:test';
import assert from 'node:assert/strict';
import { COIN_VIEWS, pathForView, viewFromPath, isCoinPath, VIEW_TITLES } from '../src/utils/coinRoutes.js';

// Every icon of the /icaneracoin bottom bar is a page with its own address. These hold the address <-> page mapping.

test('every view has an address that maps back to it', () => {
  for (const view of Object.keys(COIN_VIEWS)) {
    assert.equal(viewFromPath(pathForView(view)), view);
    assert.ok(VIEW_TITLES[view], `${view} has a title`);
  }
});

test('the chart is the front door; the others live one level down', () => {
  assert.equal(pathForView('chart'), '/icaneracoin');
  assert.equal(pathForView('sectors'), '/icaneracoin/data');
  assert.equal(pathForView('tokens'), '/icaneracoin/stable');
});

test('trailing slashes and capitals still find the page; unknown addresses fall back to the chart', () => {
  assert.equal(viewFromPath('/icaneracoin/'), 'chart');
  assert.equal(viewFromPath('/IcanEraCoin/Learn/'), 'learn');
  assert.equal(viewFromPath('/icaneracoin/nope'), 'chart');
  assert.equal(viewFromPath(undefined), 'chart');
});

test('only the page\'s own addresses are claimed', () => {
  assert.ok(isCoinPath('/icaneracoin'));
  assert.ok(isCoinPath('/icaneracoin/analysis/'));
  assert.ok(!isCoinPath('/icaneracoin/analysis/extra'));
  assert.ok(!isCoinPath('/icaneracoin/unknown'));
  assert.ok(!isCoinPath('/shop'));
});
