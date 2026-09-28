import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolSurface } from '../src/app/toolSurface.ts';

function fixture() {
  const calls = [];
  const track = (name) => (...args) => { calls.push([name, ...args]); };
  const api = {
    camera: { flyToLatLon: track('fly') }, clock: { setFraction: track('time'), setPlaying: track('playing'), state: () => ({}) },
    store: { entity: (id) => id === 'node:a' ? { id } : undefined, snapshot: { meta: {} } },
    getLayers: () => [{ id: 'transport.road', visible: true }], setLayerVisible: track('layer'), setPreset: track('preset'),
    setFlowMode: track('flow'), select: track('select'), focus: track('focus'), search: () => [{ id: 'node:a' }],
    runCommand: track('command'), getSelection: () => null, getSelectedCountry: () => null,
    getPreset: () => 'world', getFlowMode: () => false, startFollowTheLoad: track('demo'),
  };
  const tools = new Map(buildToolSurface(api).map((t) => [t.name, t]));
  return { calls, invoke: (name, args) => tools.get(name).invoke(args) };
}

for (const [name, args] of [
  ['fly_to', { lat: 0, lon: 0, altitude: 1 }], ['find', { query: 'test' }],
  ['select_entity', { id: 'node:a' }], ['set_layer', { layer: 'transport.road', visible: false }],
  ['set_preset', { preset: 'freight' }], ['set_flow_mode', { enabled: false }],
  ['set_time', { fraction: 0.5 }], ['set_playing', { playing: false }],
  ['run_command', { command: 'show ports' }], ['get_state', {}], ['follow_the_load', {}],
]) test(`view tool accepts declared arguments: ${name}`, () => {
  const f = fixture(); f.invoke(name, args);
  if (name !== 'get_state') assert.equal(f.calls.length, 1);
});

for (const [name, args] of [
  ['fly_to', {}], ['fly_to', { lat: '0', lon: 0 }], ['fly_to', { lat: NaN, lon: 0 }],
  ['fly_to', { lat: 0, lon: Infinity }], ['fly_to', { lat: 91, lon: 0 }],
  ['fly_to', { lat: 0, lon: -181 }], ['fly_to', { lat: 0, lon: 0, altitude: -1 }],
  ['fly_to', { lat: 0, lon: 0, altitude: 1001 }], ['fly_to', { lat: 0, lon: 0, code: 'run' }],
  ['set_time', { fraction: -0.1 }], ['set_time', { fraction: 1.1 }], ['set_time', { fraction: '0.5' }],
  ['set_flow_mode', { enabled: 'false' }], ['set_playing', { playing: 0 }],
  ['set_layer', { layer: 'transport.road', visible: 'false' }],
  ['set_layer', { layer: 'arbitrary', visible: false }], ['set_preset', { preset: 'arbitrary' }],
  ['select_entity', { id: 'missing' }], ['select_entity', { id: 'bad id' }],
  ['find', { query: '' }], ['find', { query: 'x'.repeat(4097) }],
  ['run_command', { command: 'bad\ncommand' }], ['get_state', { secret: true }],
  ['get_state', null], ['get_state', []], ['get_state', new Date()],
]) test(`view tool refuses malformed ${name}: ${JSON.stringify(args).slice(0, 100)}`, () => {
  const f = fixture(); assert.throws(() => f.invoke(name, args)); assert.deepEqual(f.calls, []);
});

test('view tools never execute argument accessors or inherit required fields', () => {
  const f = fixture();
  assert.throws(() => f.invoke('set_time', { get fraction() { assert.fail('getter must not execute'); } }), /Invalid/);
  assert.throws(() => f.invoke('set_time', Object.create({ fraction: 0.5 })), /plain object/);
  assert.deepEqual(f.calls, []);
});

test('false stays false; all malformed values are rejected before dispatch', () => {
  const f = fixture(); f.invoke('set_layer', { layer: 'transport.road', visible: false });
  f.invoke('set_flow_mode', { enabled: false }); f.invoke('set_playing', { playing: false });
  assert.deepEqual(f.calls, [['layer', 'transport.road', false], ['flow', false], ['playing', false]]);
});
