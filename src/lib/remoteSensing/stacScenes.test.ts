import { describe, it } from 'vitest';
import { sceneCases } from './stacScenes.cases';
describe('GIS/RS STAC scene metadata, acquisition and envelope projection', () => {
  for (const scenario of sceneCases()) it(scenario.name, scenario.run);
});
