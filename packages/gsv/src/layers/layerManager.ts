/**
 * Layer registry: composable visibility state + view presets.
 * Render layers register apply-callbacks; UI reads defs and toggles.
 */

import type { LayerDef, LayerId, ViewPreset } from '../app/api';

const DEFS: [LayerId, string, LayerDef['group'], boolean][] = [
  ['world.countries', 'Countries', 'WORLD', true],
  ['world.cities', 'Cities', 'WORLD', true],
  ['world.terrain', 'Graticule', 'WORLD', false],
  ['world.nightlights', 'Night lights', 'WORLD', true],
  ['transport.road', 'Road', 'TRANSPORT', true],
  ['transport.rail', 'Rail', 'TRANSPORT', true],
  ['transport.maritime', 'Maritime', 'TRANSPORT', true],
  ['transport.air', 'Air', 'TRANSPORT', true],
  ['infra.ports', 'Ports', 'INFRASTRUCTURE', true],
  ['infra.airports', 'Airports', 'INFRASTRUCTURE', true],
  ['infra.rail_terminals', 'Rail terminals', 'INFRASTRUCTURE', true],
  ['infra.warehouses', 'Warehouses', 'INFRASTRUCTURE', true],
  ['infra.industrial', 'Industrial facilities', 'INFRASTRUCTURE', true],
  ['economy.production', 'Production', 'ECONOMY', false],
  ['economy.demand', 'Demand', 'ECONOMY', false],
  ['economy.inventory', 'Inventory', 'ECONOMY', false],
  ['economy.flows', 'Commodity flows', 'ECONOMY', false],
  ['intel.bottlenecks', 'Bottlenecks', 'INTELLIGENCE', true],
  ['intel.constraints', 'Constraints', 'INTELLIGENCE', false],
  ['intel.anomalies', 'Anomalies', 'INTELLIGENCE', false],
  ['intel.dependencies', 'Dependencies', 'INTELLIGENCE', false],
  ['intel.risk', 'Risk', 'INTELLIGENCE', false],
];

const PRESETS: Record<ViewPreset, Partial<Record<LayerId, boolean>>> = {
  world: Object.fromEntries(DEFS.map(([id, , , v]) => [id, v])),
  freight: {
    'world.nightlights': true,
    'transport.road': true,
    'transport.rail': true,
    'transport.maritime': true,
    'transport.air': true,
    'infra.ports': true,
    'infra.airports': true,
    'infra.rail_terminals': true,
    'infra.warehouses': true,
    'infra.industrial': true,
    'economy.flows': true,
    'intel.bottlenecks': true,
    'intel.constraints': true,
    'intel.anomalies': false,
    'intel.risk': false,
    'economy.production': false,
    'economy.demand': false,
    'economy.inventory': false,
  },
  trade: {
    'transport.road': false,
    'transport.rail': false,
    'transport.maritime': true,
    'transport.air': true,
    'infra.ports': true,
    'infra.airports': true,
    'infra.rail_terminals': false,
    'infra.warehouses': false,
    'infra.industrial': false,
    'economy.flows': true,
    'intel.bottlenecks': true,
    'intel.constraints': true,
    'intel.risk': false,
    'intel.anomalies': false,
  },
  commodities: {
    'transport.road': false,
    'transport.rail': true,
    'transport.maritime': true,
    'transport.air': false,
    'infra.ports': true,
    'infra.airports': false,
    'infra.rail_terminals': true,
    'infra.warehouses': false,
    'infra.industrial': true,
    'economy.production': true,
    'economy.flows': true,
    'intel.bottlenecks': true,
    'intel.anomalies': false,
    'intel.risk': false,
  },
  network: {
    'transport.road': true,
    'transport.rail': true,
    'transport.maritime': true,
    'transport.air': true,
    'infra.ports': true,
    'infra.airports': true,
    'infra.rail_terminals': true,
    'infra.warehouses': true,
    'infra.industrial': true,
    'intel.dependencies': true,
    'economy.flows': false,
    'intel.anomalies': false,
    'intel.risk': false,
  },
  exceptions: {
    'transport.road': true,
    'transport.rail': true,
    'transport.maritime': true,
    'transport.air': true,
    'infra.ports': true,
    'infra.airports': true,
    'infra.rail_terminals': true,
    'infra.warehouses': false,
    'infra.industrial': false,
    'economy.flows': false,
    'intel.bottlenecks': true,
    'intel.constraints': true,
    'intel.anomalies': true,
    'intel.risk': true,
  },
};

export class LayerManager {
  private defs: LayerDef[];
  private appliers = new Map<LayerId, ((visible: boolean) => void)[]>();
  onChange: ((layers: LayerDef[]) => void) | null = null;

  constructor() {
    this.defs = DEFS.map(([id, label, group, visible]) => ({ id, label, group, visible }));
  }

  register(id: LayerId, apply: (visible: boolean) => void): void {
    const arr = this.appliers.get(id) ?? [];
    arr.push(apply);
    this.appliers.set(id, arr);
    apply(this.get(id)!.visible);
  }

  get(id: LayerId): LayerDef | undefined {
    return this.defs.find((d) => d.id === id);
  }

  list(): LayerDef[] {
    return this.defs.map((d) => ({ ...d }));
  }

  isVisible(id: LayerId): boolean {
    return this.get(id)?.visible ?? false;
  }

  setVisible(id: LayerId, visible: boolean, silent = false): void {
    const def = this.get(id);
    if (!def || def.visible === visible) return;
    def.visible = visible;
    for (const fn of this.appliers.get(id) ?? []) fn(visible);
    if (!silent) this.onChange?.(this.list());
  }

  applyPreset(preset: ViewPreset): void {
    const map = PRESETS[preset];
    for (const [id, v] of Object.entries(map)) {
      this.setVisible(id as LayerId, v as boolean, true);
    }
    this.onChange?.(this.list());
  }

  /** Exceptions preset dims healthy routes; expose the flag per preset. */
  presetDimsHealthy(preset: ViewPreset): boolean {
    return preset === 'exceptions';
  }
}
