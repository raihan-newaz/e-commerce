import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCourierLocations } from '../orderLocationService';
import { normalizeLocation } from '../courierLocations';

const rows = [
  { id: 'p-city', provider: 'PATHAO', level: 'DISTRICT', externalId: '1', parentExternalId: null, name: 'Dhaka', active: true },
  { id: 'p-zone', provider: 'PATHAO', level: 'THANA', externalId: '10', parentExternalId: '1', name: 'Gulshan', active: true },
  { id: 'p-area', provider: 'PATHAO', level: 'AREA', externalId: '100', parentExternalId: '10', name: 'Niketan', active: true },
  { id: 'r-a', provider: 'REDX', level: 'AREA', externalId: '201', parentExternalId: null, name: 'Uttara', districtName: 'Dhaka', active: true },
  { id: 'r-b', provider: 'REDX', level: 'AREA', externalId: '202', parentExternalId: null, name: 'Uttara', districtName: 'Chattogram', active: true },
] as const;

test('matches Bengali aliases within the selected district and preserves courier hierarchy', () => {
  const matches = matchCourierLocations(
    { customerAddress: 'বাড়ি ১২, গুলশান, ঢাকা', district: 'ঢাকা' },
    [...rows],
    [{ locationId: 'p-city', normalizedAlias: normalizeLocation('ঢাকা') }, { locationId: 'p-zone', normalizedAlias: normalizeLocation('গুলশান') }],
  );
  assert.equal(matches.PATHAO.source, 'AUTO');
  assert.equal(matches.PATHAO.districtExternalId, '1');
  assert.equal(matches.PATHAO.thanaExternalId, '10');
  assert.equal(matches.PATHAO.areaExternalId, undefined);
});

test('uses a matching RedX division hint to disambiguate duplicate area names', () => {
  const matches = matchCourierLocations(
    { customerAddress: 'Uttara, Dhaka', city: 'Dhaka' },
    [...rows],
    [],
  );
  assert.equal(matches.REDX.source, 'AUTO');
  assert.equal(matches.REDX.areaExternalId, '201');
});

test('leaves RedX area unresolved when the address matches multiple cached areas', () => {
  const matches = matchCourierLocations(
    { customerAddress: 'Uttara' },
    [...rows],
    [],
  );
  assert.deepEqual(matches.REDX, { source: 'UNRESOLVED' });
});
