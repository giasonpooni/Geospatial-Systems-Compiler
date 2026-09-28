/**
 * COMMAND GRAMMAR — the parser behind the command bar (and, later,
 * the agent tool surface).
 *
 * Pure functions over the AppApi facade: no module state, no DOM.
 * Case-insensitive, forgiving; first matching rule wins. All result
 * messages are QUIET CAPS mono style ('MARITIME ON', 'FOCUS PORT OF
 * ROTTERDAM').
 */

import type { AppApi, CommandResult, LayerId, Suggestion, ViewPreset } from './api';
import type { Flow, Route } from '../data/contracts';
import type { SearchResult } from '../data/store';

// ------------------------------------------------------------------
// Static tables (immutable data, not state)
// ------------------------------------------------------------------

/** thing-alias → layer. Longest aliases are matched exactly on the
 *  normalized remainder of 'show <thing>' / 'hide <thing>'. */
const LAYER_ALIASES: Record<string, LayerId> = {
  road: 'transport.road',
  roads: 'transport.road',
  trucking: 'transport.road',
  rail: 'transport.rail',
  railways: 'transport.rail',
  maritime: 'transport.maritime',
  shipping: 'transport.maritime',
  sea: 'transport.maritime',
  air: 'transport.air',
  flights: 'transport.air',
  ports: 'infra.ports',
  airports: 'infra.airports',
  'rail terminals': 'infra.rail_terminals',
  terminals: 'infra.rail_terminals',
  warehouses: 'infra.warehouses',
  distribution: 'infra.warehouses',
  industrial: 'infra.industrial',
  industry: 'infra.industrial',
  facilities: 'infra.industrial',
  countries: 'world.countries',
  borders: 'world.countries',
  cities: 'world.cities',
  labels: 'world.cities',
  'night lights': 'world.nightlights',
  lights: 'world.nightlights',
  terrain: 'world.terrain',
  graticule: 'world.terrain',
  flows: 'economy.flows',
  'commodity flows': 'economy.flows',
  bottlenecks: 'intel.bottlenecks',
  chokepoints: 'intel.bottlenecks',
  constraints: 'intel.constraints',
  anomalies: 'intel.anomalies',
  dependencies: 'intel.dependencies',
  'supply dependencies': 'intel.dependencies',
  risk: 'intel.risk',
};

/** Display names for layer toggle result messages. */
const LAYER_LABELS: Record<LayerId, string> = {
  'world.countries': 'COUNTRIES',
  'world.cities': 'CITIES',
  'world.terrain': 'TERRAIN',
  'world.nightlights': 'NIGHT LIGHTS',
  'transport.road': 'ROAD',
  'transport.rail': 'RAIL',
  'transport.maritime': 'MARITIME',
  'transport.air': 'AIR',
  'infra.ports': 'PORTS',
  'infra.airports': 'AIRPORTS',
  'infra.rail_terminals': 'RAIL TERMINALS',
  'infra.warehouses': 'WAREHOUSES',
  'infra.industrial': 'INDUSTRIAL',
  'economy.production': 'PRODUCTION',
  'economy.demand': 'DEMAND',
  'economy.inventory': 'INVENTORY',
  'economy.flows': 'FLOWS',
  'intel.bottlenecks': 'BOTTLENECKS',
  'intel.constraints': 'CONSTRAINTS',
  'intel.anomalies': 'ANOMALIES',
  'intel.dependencies': 'DEPENDENCIES',
  'intel.risk': 'RISK',
};

const TRANSPORT_LAYERS: LayerId[] = [
  'transport.road',
  'transport.rail',
  'transport.maritime',
  'transport.air',
];

const INFRA_LAYERS: LayerId[] = [
  'infra.ports',
  'infra.airports',
  'infra.rail_terminals',
  'infra.warehouses',
  'infra.industrial',
];

const PRESETS: ViewPreset[] = [
  'world',
  'freight',
  'trade',
  'commodities',
  'network',
  'exceptions',
];

const HINT = 'TRY: find <place> · show <layer> · follow the load';

const HELP_MESSAGE =
  'FIND <NAME> · SHOW/HIDE <LAYER> · FLOWS ON/OFF · PLAY/PAUSE · SPEED 1H/6H/24H · NOW · ' +
  'COMPARE <A> VS <B> · WORLD/FREIGHT/TRADE/COMMODITIES/NETWORK/EXCEPTIONS · FOLLOW THE LOAD · EXIT';

const STARTERS: Suggestion[] = [
  { text: 'Find Toronto', label: 'Find Toronto', hint: 'SEARCH' },
  { text: 'Show maritime', label: 'Show maritime', hint: 'LAYER' },
  { text: 'Show bottlenecks', label: 'Show bottlenecks', hint: 'INTEL' },
  { text: 'Follow the load', label: 'Follow the load', hint: 'DEMO' },
  { text: 'Show copper flows', label: 'Show copper flows', hint: 'FLOWS' },
  { text: 'Compare routes', label: 'Compare <a> vs <b>', hint: 'ROUTES' },
  { text: 'Exceptions', label: 'Exceptions preset', hint: 'PRESET' },
];

/** Verb templates offered as prefix completions in suggestCommands. */
const VERB_SUGGESTIONS: Suggestion[] = [
  { text: 'find ', label: 'find <name>', hint: 'SEARCH' },
  { text: 'goto ', label: 'goto <name>', hint: 'SEARCH' },
  { text: 'show ', label: 'show <layer>', hint: 'LAYER' },
  { text: 'hide ', label: 'hide <layer>', hint: 'LAYER' },
  { text: 'flows on', label: 'flows on', hint: 'FLOWS' },
  { text: 'flows off', label: 'flows off', hint: 'FLOWS' },
  { text: 'follow the load', label: 'follow the load', hint: 'DEMO' },
  { text: 'stop demo', label: 'stop demo', hint: 'DEMO' },
  { text: 'compare ', label: 'compare <a> vs <b>', hint: 'ROUTES' },
  { text: 'play', label: 'play', hint: 'TIME' },
  { text: 'pause', label: 'pause', hint: 'TIME' },
  { text: 'now', label: 'now', hint: 'TIME' },
  { text: 'speed 1h', label: 'speed 1h', hint: 'TIME' },
  { text: 'speed 6h', label: 'speed 6h', hint: 'TIME' },
  { text: 'speed 24h', label: 'speed 24h', hint: 'TIME' },
  { text: 'world', label: 'world', hint: 'PRESET' },
  { text: 'freight', label: 'freight', hint: 'PRESET' },
  { text: 'trade', label: 'trade', hint: 'PRESET' },
  { text: 'commodities', label: 'commodities', hint: 'PRESET' },
  { text: 'network', label: 'network', hint: 'PRESET' },
  { text: 'exceptions', label: 'exceptions', hint: 'PRESET' },
  { text: 'help', label: 'help', hint: 'HELP' },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function ok(message: string): CommandResult {
  return { ok: true, message };
}
function err(message: string): CommandResult {
  return { ok: false, message };
}

function normalize(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function fmtKm(km: number): string {
  return Math.round(km).toLocaleString('en-US');
}

function pct(u: number): string {
  return `${Math.round(u * 100)}%`;
}

/** find/goto/bare-entity: search, focus the best hit. */
function runFind(api: AppApi, q: string, hintOnMiss: boolean): CommandResult {
  const results = api.search(q);
  if (!results.length) {
    return err(
      hintOnMiss ? `NO MATCH FOR "${q.toUpperCase()}" · ${HINT}` : `NO MATCH FOR "${q.toUpperCase()}"`
    );
  }
  const best = results[0];
  api.focus(best.id);
  return ok(`FOCUS ${best.name.toUpperCase()}`);
}

function setLayers(api: AppApi, ids: LayerId[], visible: boolean): void {
  for (const id of ids) api.setLayerVisible(id, visible);
}

/** Flows matching a commodity term by flow name or commodity name. */
function matchFlows(api: AppApi, term: string): Flow[] {
  const t = term.toLowerCase();
  return api.store.snapshot.flows.filter((f) => {
    if (f.name.toLowerCase().includes(t)) return true;
    const c = api.store.commodity(f.commodityId);
    return !!c && c.name.toLowerCase().includes(t);
  });
}

/** 'show <commodity> flows' / '<commodity> flows'. */
function runCommodityFlows(api: AppApi, term: string): CommandResult {
  const matches = matchFlows(api, term);
  if (!matches.length) return err(`NO FLOWS FOR "${term.toUpperCase()}"`);
  api.setLayerVisible('economy.flows', true);
  api.setFlowMode(true);
  api.focus(matches[0].id);
  const listed = matches.slice(0, 4).map((f) => f.name.toUpperCase());
  const more = matches.length > listed.length ? ` +${matches.length - listed.length}` : '';
  api.events.emit('toast', {
    title: `${term.toUpperCase()} FLOWS · ${matches.length}`,
    body: listed.join(' · ') + more,
    tone: 'info',
  });
  return ok(`${term.toUpperCase()} FLOWS ON · ${matches.length} MATCHED`);
}

/** Resolve a query to a Route via best search hit, else undefined. */
function findRoute(api: AppApi, q: string): Route | undefined {
  for (const r of api.search(q)) {
    const route = api.store.route(r.id);
    if (route) return route;
  }
  return undefined;
}

function runCompare(api: AppApi, aq: string, bq: string): CommandResult {
  const aHit = api.search(aq)[0];
  const bHit = api.search(bq)[0];
  if (!aHit) return err(`NO MATCH FOR "${aq.toUpperCase()}"`);
  if (!bHit) return err(`NO MATCH FOR "${bq.toUpperCase()}"`);
  const a = findRoute(api, aq);
  const b = findRoute(api, bq);
  if (!a || !b) return err('COMPARE NEEDS TWO ROUTES');
  const t = api.clock.simTime;
  const ua = api.store.stateAt(a.id, t).utilization;
  const ub = api.store.stateAt(b.id, t).utilization;
  const line =
    `${a.name.toUpperCase()} ${fmtKm(a.distanceKm)} KM / ${pct(ua)} · ` +
    `${b.name.toUpperCase()} ${fmtKm(b.distanceKm)} KM / ${pct(ub)}`;
  api.select(a.id, 'command');
  api.events.emit('toast', {
    title: 'ROUTE COMPARISON',
    body:
      `${a.name.toUpperCase()} ${fmtKm(a.distanceKm)} KM · ${Math.round(a.estimatedDurationHours)}H PROMISED · ${pct(ua)} · ` +
      `${b.name.toUpperCase()} ${fmtKm(b.distanceKm)} KM · ${Math.round(b.estimatedDurationHours)}H PROMISED · ${pct(ub)}`,
    tone: 'info',
  });
  return ok(line);
}

// ------------------------------------------------------------------
// executeCommand
// ------------------------------------------------------------------

export function executeCommand(api: AppApi, input: string): CommandResult {
  const text = normalize(input);
  if (!text) return err(HINT);
  const lower = text.toLowerCase();

  // -- 8. help
  if (lower === 'help' || lower === '?') return ok(HELP_MESSAGE);

  // -- 6. time controls
  if (lower === 'play') {
    api.clock.setPlaying(true);
    return ok('PLAY');
  }
  if (lower === 'pause') {
    api.clock.setPlaying(false);
    return ok('PAUSE');
  }
  if (lower === 'now') {
    api.clock.jumpToNow();
    return ok('SIM TIME → NOW');
  }
  const speed = /^speed\s+(\d+)\s*h(?:ours?)?(?:\/s)?$/.exec(lower);
  if (speed) {
    const hours = parseInt(speed[1], 10);
    if (hours <= 0) return err('SPEED MUST BE > 0');
    api.clock.setSpeed(hours * 3600);
    return ok(`SPEED ${hours}H/S`);
  }

  // -- 3. flow mode
  const flowToggle = /^flows?(?:\s+mode)?\s+(on|off)$/.exec(lower);
  if (flowToggle) {
    const enabled = flowToggle[1] === 'on';
    api.setFlowMode(enabled);
    return ok(enabled ? 'FLOW MODE ON' : 'FLOW MODE OFF');
  }
  if (lower === 'flow mode' || lower === 'flows') {
    const next = !api.getFlowMode();
    api.setFlowMode(next);
    return ok(next ? 'FLOW MODE ON' : 'FLOW MODE OFF');
  }

  // -- 4. demo
  if (lower === 'follow the load' || lower === 'demo') {
    api.startFollowTheLoad();
    return ok('FOLLOW THE LOAD');
  }
  if (lower === 'stop demo' || lower === 'exit' || lower === 'stop') {
    api.stopFollowTheLoad();
    return ok('DEMO STOPPED');
  }

  // -- 5. bare preset word
  if ((PRESETS as string[]).includes(lower)) {
    api.setPreset(lower as ViewPreset);
    return ok(`PRESET ${lower.toUpperCase()}`);
  }

  // -- 2. show / hide
  const showHide = /^(show|hide)\s+(.+)$/.exec(lower);
  if (showHide) {
    const visible = showHide[1] === 'show';
    const thing = showHide[2].trim();

    if (thing === 'everything' || thing === 'all') {
      setLayers(api, [...TRANSPORT_LAYERS, ...INFRA_LAYERS], visible);
      return ok(visible ? 'ALL TRANSPORT + INFRASTRUCTURE ON' : 'ALL TRANSPORT + INFRASTRUCTURE OFF');
    }
    if (thing === 'freight corridors' || thing === 'corridors') {
      setLayers(api, TRANSPORT_LAYERS, visible);
      return ok(visible ? 'FREIGHT CORRIDORS ON' : 'FREIGHT CORRIDORS OFF');
    }

    const layer = LAYER_ALIASES[thing];
    if (layer) {
      api.setLayerVisible(layer, visible);
      if (layer === 'economy.flows') api.setFlowMode(visible);
      return ok(`${LAYER_LABELS[layer]} ${visible ? 'ON' : 'OFF'}`);
    }

    // 'show <commodity> flows'
    const commodityFlows = /^(.+?)\s+flows$/.exec(thing);
    if (visible && commodityFlows) return runCommodityFlows(api, commodityFlows[1]);

    return err(`UNKNOWN LAYER "${thing.toUpperCase()}" · ${HINT}`);
  }

  // -- 7. compare <a> vs <b> / compare routes a and b
  const compare = /^compare\s+(?:routes?\s+)?(.+?)\s+(?:vs\.?|and)\s+(.+)$/.exec(lower);
  if (compare) return runCompare(api, compare[1], compare[2]);

  // -- '<commodity> flows' without the show verb
  const bareFlows = /^(.+?)\s+flows$/.exec(lower);
  if (bareFlows && !LAYER_ALIASES[lower]) return runCommodityFlows(api, bareFlows[1]);

  // -- 1. find / goto
  const find = /^(?:find|goto|go to)\s+(.+)$/.exec(lower);
  if (find) return runFind(api, find[1], false);

  // -- fallback: bare text that matches an entity, else hint
  return runFind(api, text, true);
}

// ------------------------------------------------------------------
// suggestCommands
// ------------------------------------------------------------------

export function suggestCommands(api: AppApi, input: string): Suggestion[] {
  const text = normalize(input);
  if (!text) return STARTERS.slice();
  const lower = text.toLowerCase();

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion) => {
    const key = s.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  // verb completions matching the prefix
  for (const v of VERB_SUGGESTIONS) {
    if (v.text.toLowerCase().startsWith(lower) || v.label.toLowerCase().startsWith(lower)) {
      push(v);
    }
  }

  // layer completions for 'show <partial>' / 'hide <partial>'
  const showHide = /^(show|hide)\s+(.*)$/.exec(lower);
  if (showHide) {
    const verb = showHide[1];
    const partial = showHide[2];
    for (const alias of Object.keys(LAYER_ALIASES)) {
      if (!partial || alias.startsWith(partial)) {
        push({
          text: `${verb} ${alias}`,
          label: `${verb} ${alias}`,
          hint: LAYER_LABELS[LAYER_ALIASES[alias]],
        });
      }
      if (out.length >= 12) break;
    }
  }

  // commodity special-case: 'copper' → show copper flows
  for (const c of api.store.snapshot.commodities) {
    const cname = c.name.toLowerCase();
    if (cname.includes(lower) || lower.includes(cname)) {
      push({
        text: `show ${cname} flows`,
        label: `show ${c.name} flows`,
        hint: 'FLOWS',
      });
      push({ text: 'show flows', label: 'show flows', hint: 'LAYER' });
      break;
    }
  }

  // entity results as find-suggestions
  const results: SearchResult[] = api.search(lower).slice(0, 5);
  for (const r of results) {
    push({
      text: `find ${r.name}`,
      label: r.name,
      hint: r.kind.toUpperCase(),
    });
  }

  return out.slice(0, 12);
}
