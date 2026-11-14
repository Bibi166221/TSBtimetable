'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const exporter = fs.readFileSync(path.join(__dirname,'../public/exportImage.js'),'utf8');

test('paired main boards share the same hour list from both directions', () => {
  assert.match(app,/function sharedHourWindow\(left, right\)/);
  assert.match(app,/const shared = sharedHourWindow\(result\.go, result\.back\)/);
  assert.match(app,/shared\?\.hours, shared\?\.hourFormat/g);
  assert.match(app,/for \(let h = first; h <= last; h\+\+\)/);
});
test('hours with no departures have no dash placeholder', () => {
  assert.doesNotMatch(app,/className\s*=\s*['"]minute dash['"]/);
  assert.match(app,/const departures = byHour\.get\(h\) \|\| \[\]/);
});
test('aligned rows are maintained in browser and high resolution export', () => {
  assert.match(app,/function alignMainRowHeights\(\)/);
  assert.match(exporter,/leftRows\[i\]\.dataset\.serviceHour !== rightRows\[i\]\.dataset\.serviceHour/);
});
