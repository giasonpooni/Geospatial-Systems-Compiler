/**
 * Structured tool surface over the AppApi facade — the GeoAgent
 * pattern: one registry of operations with metadata (description,
 * params, safety flags) that BOTH the human command bar and a future
 * external agent binding can consume. No external binding is implemented.
 * The twin stays a mirror: every tool here is a VIEW operation;
 * nothing mutates canonical state, so nothing needs a confirmation
 * gate yet — the flags exist so gated operations can be added without
 * changing the shape.
 *
 * Exposed at runtime as window.payloadEarth.tools.
 */

import type { AppApi, LayerId, ViewPreset } from './api';
import { finite, identifier, text } from '../data/validation.ts';

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface TwinTool {
  name: string;
  description: string;
  category: 'navigate' | 'layers' | 'select' | 'time' | 'query' | 'demo';
  params: ToolParam[];
  safety: { destructive: boolean; longRunning: boolean; requiresConfirmation: boolean };
  invoke(args: Record<string, unknown>): unknown;
}

const SAFE = { destructive: false, longRunning: false, requiresConfirmation: false };

export function buildToolSurface(api: AppApi): TwinTool[] {
  const tools: TwinTool[] = [
    {
      name: 'fly_to',
      description: 'Fly the camera to a lat/lon at an optional altitude (earth radii above surface).',
      category: 'navigate',
      params: [
        { name: 'lat', type: 'number', description: 'Latitude in degrees', required: true },
        { name: 'lon', type: 'number', description: 'Longitude in degrees', required: true },
        { name: 'altitude', type: 'number', description: 'Altitude in earth radii (default keeps current)' },
      ],
      safety: SAFE,
      invoke: (a) =>
        api.camera.flyToLatLon(Number(a.lat), Number(a.lon), {
          distance: a.altitude !== undefined ? 1 + Number(a.altitude) : undefined,
        }),
    },
    {
      name: 'find',
      description: 'Search entities (nodes, routes, flows) by name and focus the best match.',
      category: 'query',
      params: [{ name: 'query', type: 'string', description: 'Name to search', required: true }],
      safety: SAFE,
      invoke: (a) => {
        const results = api.search(String(a.query));
        if (results.length) api.focus(results[0].id);
        return results;
      },
    },
    {
      name: 'select_entity',
      description: 'Select an entity by id (opens the inspector).',
      category: 'select',
      params: [{ name: 'id', type: 'string', description: 'Entity id', required: true }],
      safety: SAFE,
      invoke: (a) => api.select(String(a.id), 'command'),
    },
    {
      name: 'set_layer',
      description: 'Toggle a named layer (e.g. transport.maritime, intel.bottlenecks).',
      category: 'layers',
      params: [
        { name: 'layer', type: 'string', description: 'Layer id', required: true },
        { name: 'visible', type: 'boolean', description: 'Visibility', required: true },
      ],
      safety: SAFE,
      invoke: (a) => api.setLayerVisible(String(a.layer) as LayerId, Boolean(a.visible)),
    },
    {
      name: 'set_preset',
      description: 'Apply a view preset: world, freight, trade, commodities, network, exceptions.',
      category: 'layers',
      params: [{ name: 'preset', type: 'string', description: 'Preset name', required: true }],
      safety: SAFE,
      invoke: (a) => api.setPreset(String(a.preset) as ViewPreset),
    },
    {
      name: 'set_flow_mode',
      description: 'Enable or disable animated flow particles.',
      category: 'layers',
      params: [{ name: 'enabled', type: 'boolean', description: 'On/off', required: true }],
      safety: SAFE,
      invoke: (a) => api.setFlowMode(Boolean(a.enabled)),
    },
    {
      name: 'set_time',
      description: 'Scrub simulation time to a fraction of the configured range (0..1).',
      category: 'time',
      params: [{ name: 'fraction', type: 'number', description: '0..1 across the time range', required: true }],
      safety: SAFE,
      invoke: (a) => api.clock.setFraction(Number(a.fraction)),
    },
    {
      name: 'set_playing',
      description: 'Play or pause simulation time.',
      category: 'time',
      params: [{ name: 'playing', type: 'boolean', description: 'Play state', required: true }],
      safety: SAFE,
      invoke: (a) => api.clock.setPlaying(Boolean(a.playing)),
    },
    {
      name: 'run_command',
      description: 'Run a command-bar command string (find/show/hide/compare/…).',
      category: 'query',
      params: [{ name: 'command', type: 'string', description: 'Command text', required: true }],
      safety: SAFE,
      invoke: (a) => api.runCommand(String(a.command)),
    },
    {
      name: 'get_state',
      description:
        'Snapshot of twin view state: sim time/regime, selection, preset, layers, data disclaimer.',
      category: 'query',
      params: [],
      safety: SAFE,
      invoke: () => ({
        time: api.clock.state(),
        selection: api.getSelection(),
        country: api.getSelectedCountry(),
        preset: api.getPreset(),
        flowMode: api.getFlowMode(),
        layers: api.getLayers(),
        data: api.store.snapshot.meta,
      }),
    },
    {
      name: 'follow_the_load',
      description: 'Run the cinematic multimodal demo scenario (Toronto → Chicago).',
      category: 'demo',
      params: [],
      safety: { ...SAFE, longRunning: true },
      invoke: () => api.startFollowTheLoad(),
    },
  ];
  return tools.map((tool) => ({ ...tool, invoke(args: Record<string, unknown>) {
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(args)) || Object.getOwnPropertySymbols(args).length)
      throw new Error('Tool arguments must be a plain object');
    const properties = Object.getOwnPropertyDescriptors(args);
    if (Object.keys(properties).some((key) => !tool.params.some((p) => p.name === key))) throw new Error('Unknown tool argument');
    for (const param of tool.params) {
      const property = properties[param.name];
      if (!property) { if (param.required) throw new Error(`Missing ${param.name}`); continue; }
      if (!('value' in property) || !property.enumerable || typeof property.value !== param.type) throw new Error(`Invalid ${param.name}`);
      if (param.type === 'number') finite(property.value, param.name);
      if (param.type === 'string') text(property.value, param.name);
    }
    if (tool.name === 'fly_to') {
      finite(args.lat, 'lat', -90, 90); finite(args.lon, 'lon', -180, 180);
      if (args.altitude !== undefined) finite(args.altitude, 'altitude', 0, 1000);
    }
    if (tool.name === 'set_time') finite(args.fraction, 'fraction', 0, 1);
    if (tool.name === 'set_layer' && !api.getLayers().some((layer) => layer.id === args.layer)) throw new Error('Unknown layer');
    if (tool.name === 'set_preset' && !['world', 'freight', 'trade', 'commodities', 'network', 'exceptions'].includes(args.preset as string)) throw new Error('Unknown preset');
    if (tool.name === 'select_entity' && !api.store.entity(identifier(args.id, 'id'))) throw new Error('Unknown entity');
    return tool.invoke(args);
  } }));
}
