/** Robot playback must wait for the same movement renderer used by human input. */
export class RobotCadence {
  private nextActionAt: number;

  constructor(startedAt: number, private readonly interval = 420) {
    this.nextActionAt = startedAt + interval;
  }

  ready(now: number, sceneSettled: boolean): boolean {
    return sceneSettled && now >= this.nextActionAt;
  }

  didAct(now: number): void {
    // Schedule from the actual action time. A stalled frame never creates catch-up steps.
    this.nextActionAt = now + this.interval;
  }
}
