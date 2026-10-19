import { describe, expect, it } from 'vitest';
import { RobotCadence } from './robotCadence';

describe('robot playback cadence', () => {
  it('lets the reset starting position appear before the first action', () => {
    const cadence = new RobotCadence(100);
    expect(cadence.ready(100, true)).toBe(false);
    expect(cadence.ready(519, true)).toBe(false);
    expect(cadence.ready(520, true)).toBe(true);
  });

  it('waits for the rendered world and previous movement even after the interval', () => {
    const cadence = new RobotCadence(0);
    expect(cadence.ready(1000, false)).toBe(false);
    expect(cadence.ready(1000, true)).toBe(true);
    cadence.didAct(1000);
    expect(cadence.ready(1420, false)).toBe(false);
    expect(cadence.ready(1700, true)).toBe(true);
  });

  it('never batches catch-up actions after a slow first render or stalled frame', () => {
    const cadence = new RobotCadence(0);
    expect(cadence.ready(5000, true)).toBe(true);
    cadence.didAct(5000);
    for (const time of [5000, 5016, 5033, 5200, 5419]) expect(cadence.ready(time, true)).toBe(false);
    expect(cadence.ready(5420, true)).toBe(true);
  });
});
