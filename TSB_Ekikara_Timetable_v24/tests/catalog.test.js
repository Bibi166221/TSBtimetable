'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { baseOfX, parseCatalog, discoverFamily } = require('../routeCatalog');

const html = `
<select>
<option value="4-8(35)" data-start="เคหะธนบุรี" data-destination="บางลำพู">35</option>
<option data-destination='บางลำพู' data-start='เคหะธนบุรี' value='4-8X(35X)'>35X</option>
<option value="1-4(39)" data-start="มหาวิทยาลัยธรรมศาสตร์ (ศูนย์รังสิต)" data-destination="บางเขน">39</option>
<option value="1-4X(39X)" data-start="มหาวิทยาลัยธรรมศาสตร์ (ศูนย์รังสิต)" data-destination="สถานีแยก คปอ.">39X</option>
<option value="1-56(517)" data-start="A" data-destination="B">517</option>
<option value="1-56(517X)" data-start="A" data-destination="C">517X</option>
<option value="34" data-start="รังสิต" data-destination="หัวลำโพง">34</option>
<option value="34X" data-start="รังสิต" data-destination="แยกคปอ.">34X</option>
<option value="4-29E(529E)" data-start="D" data-destination="E">529E</option>
<option value="4-29EX(529EX)" data-start="D" data-destination="F">529EX</option>
<option value="4-25L(147L)" data-start="X" data-destination="Y">147L</option>
<option value="4-25R(147R)" data-start="Y" data-destination="X">147R</option>
<option value="4-25X(147X)" data-start="X" data-destination="Z">147X</option>
<option value="4-8Y(35Y)" data-start="A" data-destination="B">another route</option>
</select>`;
const catalog = parseCatalog(html);

test('parse TSB route picker with mixed attribute order and quote styles', () => {
  assert.equal(catalog.size,14);
  assert.equal(catalog.get('4-8(35)').start, 'เคหะธนบุรี');
  assert.equal(catalog.get('4-8X(35X)').destination, 'บางลำพู');
});

test('supports real-world X suffix variations', () => {
  for (const [x,base] of [
    ['4-8X(35X)', '4-8(35)'],
    ['1-4X(39X)', '1-4(39)'],
    ['34X','34'],
    ['4-29EX(529EX)','4-29E(529E)']
  ]) {
    assert.equal(baseOfX(x), base);
    assert.deepEqual(discoverFamily(base,catalog).supplementaryRoutes, [x]);
    const fromX = discoverFamily(x,catalog);
    assert.equal(fromX.primary,base);
    assert.deepEqual(fromX.supplementaryRoutes,[x]);
    assert.equal(fromX.standaloneX,false);
  }
});

test('does not pair an X service with a different L/R main route', () => {
  const x = discoverFamily('4-25X(147X)',catalog);
  assert.equal(x.primary,'4-25X(147X)');
  assert.equal(x.standaloneX,true);
  assert.deepEqual(x.supplementaryRoutes,[]);
  assert.deepEqual(discoverFamily('4-25R(147R)',catalog).supplementaryRoutes,[]);
});

test('only discovers published X services, never invented routes', () => {
  assert.deepEqual(discoverFamily('4-8Y(35Y)',catalog).supplementaryRoutes, []);
  assert.equal(baseOfX('1-4(39)'),null);
  assert.equal(baseOfX('3-29E(135E)'),null);
});


test('517 and 517X intentionally stay separate', () => {
  const main = discoverFamily('1-56(517)', catalog);
  const x = discoverFamily('1-56(517X)', catalog);
  assert.equal(main.primary,'1-56(517)');
  assert.deepEqual(main.supplementaryRoutes, []);
  assert.equal(x.primary,'1-56(517X)');
  assert.deepEqual(x.supplementaryRoutes, []);
  assert.equal(x.standaloneX,true);
});
