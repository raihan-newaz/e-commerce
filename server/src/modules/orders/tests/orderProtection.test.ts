import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClientIp, normalizeOrderPhone, orderFingerprint } from '../orderProtection';

test('normalizes Bangladesh phone numbers and validates client IPs', () => {
  assert.equal(normalizeOrderPhone('+880 1712-345678'), '01712345678');
  assert.equal(normalizeClientIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeClientIp('not-an-ip'), null);
});

test('duplicate fingerprint ignores item ordering and address punctuation but keeps quantity', () => {
  const first = orderFingerprint('01712345678', 'House 12, Gulshan, Dhaka', [
    { productId: 'a', quantity: 1 }, { productId: 'b', variantId: 'v2', quantity: 2 },
  ]);
  const equivalent = orderFingerprint('01712345678', 'House 12 Gulshan Dhaka', [
    { productId: 'b', variantId: 'v2', quantity: 2 }, { productId: 'a', quantity: 1 },
  ]);
  const differentQuantity = orderFingerprint('01712345678', 'House 12 Gulshan Dhaka', [
    { productId: 'b', variantId: 'v2', quantity: 1 }, { productId: 'a', quantity: 1 },
  ]);
  assert.equal(first, equivalent);
  assert.notEqual(first, differentQuantity);
});
