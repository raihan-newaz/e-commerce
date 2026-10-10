import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../core/registry';
import { landingCheckoutDesign } from '../landingCheckoutDesign';

test('legacy checkout placeholder is removed while saved document and real content stay intact', () => {
  const hero = createNode('container'); hero.name = 'Hero';
  const link = createNode('button'); link.props.url = '#order'; hero.children.push(link);
  const placeholder = createNode('container'); placeholder.name = 'Checkout Anchor Container';
  const anchor = createNode('container'); anchor.attributes.id = 'order'; placeholder.children.push(anchor);
  const result = landingCheckoutDesign([hero, placeholder]);
  assert.equal(result.length, 1); assert.equal(result[0].children[0].props.url, '#order');
  assert.equal(placeholder.children[0].attributes.id, 'order');
});
test('reserved anchor on an otherwise useful section preserves the section content', () => {
  const section = createNode('container'); section.name = 'Product details'; section.attributes.id = 'checkout';
  section.children.push(createNode('heading'));
  const result = landingCheckoutDesign([section]);
  assert.equal(result.length, 1); assert.equal(result[0].children.length, 1);
  assert.equal(result[0].attributes.id, undefined); assert.equal(section.attributes.id, 'checkout');
});
