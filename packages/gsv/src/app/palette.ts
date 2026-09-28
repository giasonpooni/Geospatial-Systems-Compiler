/**
 * Canonical color vocabulary of the twin. CSS tokens in theme.css
 * mirror these values — change both together.
 */

import type { TransportMode } from '../data/contracts';

export const MODE_COLORS: Record<TransportMode, number> = {
  road: 0xffb454,
  rail: 0xb48cff,
  maritime: 0x38d6c8,
  air: 0x7fb8ff,
};

export const MODE_COLORS_CSS: Record<TransportMode, string> = {
  road: '#ffb454',
  rail: '#b48cff',
  maritime: '#38d6c8',
  air: '#7fb8ff',
};

export const ACCENT = 0x4da6ff;
export const OK = 0x43d17c;
export const WARN = 0xffb454;
export const ALERT = 0xff5d6e;
/** Unobserved / unknown — state honesty, same discipline as the terminal. */
export const UNKNOWN = 0x6b7688;

export const NODE_CATEGORY_COLORS = {
  logistics: 0x4da6ff,
  extraction: 0xc9a86a,
  processing: 0xc487d8,
  industry: 0x86d99a,
  world: 0x8fa3b8,
  chokepoint: 0xffb454,
  border: 0xffb454,
} as const;

export type NodeCategory = keyof typeof NODE_CATEGORY_COLORS;
