/**
 * SimClock — the global temporal control of the twin.
 * Sim time is scrubbed/played independently of wall clock; every
 * dynamic layer resolves entity state against clock.simTime.
 */

import type { TemporalRegime, TemporalState, Timestamp } from '../data/contracts';
import { EventBus } from './events';

export interface ClockEvents extends Record<string, unknown> {
  change: TemporalState;
  playstate: { playing: boolean; speed: number };
}

export class SimClock {
  readonly events = new EventBus<ClockEvents>();

  private startMs = 0;
  private endMs = 0;
  private nowMs = 0; // dataset 'now' (regime boundary)
  private simMs = 0;
  private _playing = false;
  private _speed = 3600; // sim-seconds per wall-second (1h/s)

  configure(start: Timestamp, end: Timestamp, now: Timestamp): void {
    this.startMs = Date.parse(start);
    this.endMs = Date.parse(end);
    this.nowMs = Date.parse(now);
    this.simMs = this.nowMs;
    this.emitChange();
  }

  get simTime(): Timestamp {
    return new Date(this.simMs).toISOString();
  }
  get simMillis(): number {
    return this.simMs;
  }
  /** Normalized 0..1 position within the configured range. */
  get fraction(): number {
    return this.endMs === this.startMs
      ? 0
      : (this.simMs - this.startMs) / (this.endMs - this.startMs);
  }
  get range(): { startMs: number; endMs: number; nowMs: number } {
    return { startMs: this.startMs, endMs: this.endMs, nowMs: this.nowMs };
  }
  get playing(): boolean {
    return this._playing;
  }
  get speed(): number {
    return this._speed;
  }

  get regime(): TemporalRegime {
    const d = this.simMs - this.nowMs;
    if (Math.abs(d) < 30 * 60 * 1000) return 'current';
    return d < 0 ? 'historical' : 'forecast';
  }

  state(): TemporalState {
    return {
      t: this.simTime,
      regime: this.regime,
      referenceNow: new Date(this.nowMs).toISOString(),
    };
  }

  setFraction(f: number): void {
    this.simMs = this.startMs + Math.min(1, Math.max(0, f)) * (this.endMs - this.startMs);
    this.emitChange();
  }

  jumpToNow(): void {
    this.simMs = this.nowMs;
    this.emitChange();
  }

  setPlaying(playing: boolean): void {
    this._playing = playing;
    this.events.emit('playstate', { playing, speed: this._speed });
  }

  setSpeed(simSecondsPerSecond: number): void {
    this._speed = simSecondsPerSecond;
    this.events.emit('playstate', { playing: this._playing, speed: this._speed });
  }

  /** Advance by wall-clock dt (seconds); called from the frame loop. */
  tick(dtSeconds: number): void {
    if (!this._playing) return;
    this.simMs += dtSeconds * this._speed * 1000;
    if (this.simMs >= this.endMs) {
      this.simMs = this.endMs;
      this.setPlaying(false);
    }
    this.emitChange();
  }

  private emitChange(): void {
    this.events.emit('change', this.state());
  }
}
