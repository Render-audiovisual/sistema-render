import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DISPATCH_TIME_ZONE, dispatchScheduleFields, dispatchScheduleInstant, dispatchToday } from './publicationSchedule.js';

// Pure temporal contract. TZ variants run in isolated Node processes, never
// mutate this test runner's environment, and start no application services.
test('stored schedule is projected into one explicit Córdoba civil date/time, including midnight and year rollover', () => {
  assert.equal(DISPATCH_TIME_ZONE, 'America/Argentina/Cordoba');
  for (const [instant, fields] of [
    ['2026-07-16T01:30:00.000Z', { date: '2026-07-15', time: '22:30' }],
    ['2026-07-16T02:59:59.999Z', { date: '2026-07-15', time: '23:59' }],
    ['2026-07-16T03:00:00Z', { date: '2026-07-16', time: '00:00' }],
    ['2027-01-01T02:30:00Z', { date: '2026-12-31', time: '23:30' }],
    ['2024-03-01T02:30:00Z', { date: '2024-02-29', time: '23:30' }],
    ['2026-07-15T22:30:12.123456-03:00', { date: '2026-07-15', time: '22:30' }],
  ]) assert.deepEqual(dispatchScheduleFields(instant), fields, instant);
});
test('unset/null schedule fields stay blank, not a fabricated current date or time', () => {
  for (const instant of [undefined, null, '']) assert.deepEqual(dispatchScheduleFields(instant), { date: '', time: '' });
  assert.equal(dispatchScheduleInstant(dispatchScheduleFields(null)), null);
  assert.equal(dispatchScheduleInstant(dispatchScheduleFields(undefined), 'draft'), null);
  assert.equal(dispatchScheduleInstant({ date: '', time: '', observedScheduledAt: null }), null);
});
test('invalid non-RFC3339 observations and impossible civil timestamp components throw', () => {
  for (const value of [0, {}, [], new Date(), ' ', '2026-07-15', '2026-07-15 22:30:00Z', '2026-07-15T22:30Z',
    '2026-07-15T22:30:00', '2026-07-15T22:30:00Z\n', '0000-01-01T12:00:00Z', '2026-02-29T12:00:00Z', '1900-02-29T12:00:00Z',
    '2026-04-31T12:00:00Z', '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z', '2026-07-15T24:00:00Z',
    '2026-07-15T12:60:00Z', '2026-07-15T12:00:60Z', '2026-07-15T12:00:00+24:00', '2026-07-15T12:00:00+03:99']) {
    assert.throws(() => dispatchScheduleFields(value), String(value));
  }
});
test('new/changed civil schedule converts without late-night resave day drift in all modes', () => {
  for (const mode of ['draft', 'now', 'schedule']) for (const [date, time, expected] of [
    ['2026-07-15', '22:30', '2026-07-16T01:30:00.000Z'],
    ['2026-07-16', '00:00', '2026-07-16T03:00:00.000Z'],
    ['2024-02-29', '23:59', '2024-03-01T02:59:00.000Z'],
    ['2000-02-29', '12:00', '2000-02-29T15:00:00.000Z'],
  ]) {
    const input = Object.freeze({ date, time, observedScheduledAt: null });
    assert.equal(dispatchScheduleInstant(input, mode), expected);
    assert.deepEqual(dispatchScheduleFields(expected), { date, time });
  }
});
test('unchanged observed minute preserves EXACT original timestamp, offset, seconds and fractional precision', () => {
  for (const observedScheduledAt of ['2026-07-16T01:30:45.123456Z', '2026-07-15T22:30:59.000001-03:00', '2026-07-16T03:30:17.5+02:00']) {
    const fields = dispatchScheduleFields(observedScheduledAt);
    for (const mode of ['draft', 'now', 'schedule']) assert.equal(dispatchScheduleInstant(Object.freeze({ ...fields, observedScheduledAt }), mode), observedScheduledAt);
  }
  const observedScheduledAt = '2026-07-16T01:30:45.123456Z';
  assert.equal(dispatchScheduleInstant({ date: '2026-07-15', time: '22:31', observedScheduledAt }), '2026-07-16T01:31:00.000Z');
  assert.equal(dispatchScheduleInstant({ date: '2026-07-16', time: '22:30', observedScheduledAt }), '2026-07-17T01:30:00.000Z');
});
test('only a wholly empty draft is optional; partial/invalid schedule fails before any caller can dispatch', () => {
  for (const mode of ['draft', 'now', 'schedule']) for (const fields of [
    { date: '', time: '22:30' }, { date: '2026-07-15', time: '' }, { date: null, time: '22:30' },
    { date: '2026-07-15', time: undefined }, { date: '2026-02-29', time: '12:00' }, { date: '1900-02-29', time: '12:00' },
    { date: '2026-04-31', time: '12:00' }, { date: '2026-07-15', time: '24:00' }, { date: '2026-07-15', time: '22:60' },
    { date: '2026-07-15', time: '2:30' }, { date: '2026-7-15', time: '22:30' }, { date: '2026-07-15 ', time: '22:30' },
    { date: '2026-07-15', time: '22:30\n' },
  ]) assert.throws(() => dispatchScheduleInstant(fields, mode), `${mode}/${JSON.stringify(fields)}`);
  for (const mode of ['now', 'schedule']) assert.throws(() => dispatchScheduleInstant({ date: '', time: '' }, mode));
  for (const mode of ['', 'later', 'DRAFT', null, 1]) assert.throws(() => dispatchScheduleInstant({ date: '', time: '' }, mode));
  assert.throws(() => dispatchScheduleInstant({ date: '2026-07-15', time: '22:30', observedScheduledAt: 'bad observation' }));
});
test('explicit timezone correction supports historical offset and rejects nonexistent civil clock gap', () => {
  const instant = dispatchScheduleInstant({ date: '2008-01-15', time: '12:00' }, 'schedule');
  assert.deepEqual(dispatchScheduleFields(instant), { date: '2008-01-15', time: '12:00' });
  assert.equal(instant, '2008-01-15T14:00:00.000Z', 'Historical Córdoba DST is not the fixed modern -03 offset');
  assert.throws(() => dispatchScheduleInstant({ date: '2007-12-30', time: '00:30' }, 'schedule'));
});
test('today uses Córdoba boundary, not UTC or browser local date', () => {
  for (const [now, expected] of [['2026-07-16T02:59:59Z', '2026-07-15'], ['2026-07-16T03:00:00Z', '2026-07-16'], ['2027-01-01T02:30:00Z', '2026-12-31']]) {
    const value = new Date(now), time = value.getTime(); assert.equal(dispatchToday(value), expected); assert.equal(value.getTime(), time);
  }
  assert.throws(() => dispatchToday(new Date(NaN)));
});
test('late-night/midnight conversion, empty draft and exact observed fractions are independent of host/browser TZ', () => {
  const url = new URL('./publicationSchedule.js', import.meta.url).href;
  const script = `import {dispatchScheduleFields,dispatchScheduleInstant,dispatchToday} from ${JSON.stringify(url)};
    const observed='2026-07-16T01:30:45.123456Z';
    console.log(JSON.stringify({fields:dispatchScheduleFields(observed),unchanged:dispatchScheduleInstant({...dispatchScheduleFields(observed),observedScheduledAt:observed}),
      changed:dispatchScheduleInstant({date:'2026-07-15',time:'22:31'}),midnight:dispatchScheduleInstant({date:'2026-07-16',time:'00:00'}),
      empty:dispatchScheduleInstant(dispatchScheduleFields(null)),today:dispatchToday(new Date('2026-07-16T01:30:00Z'))}));`;
  const expected = { fields: { date: '2026-07-15', time: '22:30' }, unchanged: '2026-07-16T01:30:45.123456Z', changed: '2026-07-16T01:31:00.000Z', midnight: '2026-07-16T03:00:00.000Z', empty: null, today: '2026-07-15' };
  const originalTZ = process.env.TZ;
  for (const TZ of ['UTC', 'America/Argentina/Cordoba', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 10000 });
    assert.deepEqual(JSON.parse(output), expected, TZ);
  }
  assert.equal(process.env.TZ, originalTZ);
});
