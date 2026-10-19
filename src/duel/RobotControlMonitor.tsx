import { Box, Crosshair } from 'lucide-react';
import type { DuelPhase, DuelRobot, ManualInput } from './types';
import { SHOT_COOLDOWN } from './engine';
import './robot-controls.css';

export interface RobotControlSnapshot {
  command: ManualInput;
  hasDecision: boolean;
  shotAt: number | null;
  coverAt: number | null;
}

export function emptyRobotControl(): RobotControlSnapshot {
  return { command: { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, power: 1, fire: false, interact: false }, hasDecision: false, shotAt: null, coverAt: null };
}

/** Labels describe a continuous vector; they never quantize the model command. */
function directionName(x: number, z: number) {
  if (Math.hypot(x, z) < .001) return 'Dur';
  return ['Sağ', 'Sağ alt', 'Aşağı', 'Sol alt', 'Sol', 'Sol üst', 'Yukarı', 'Sağ üst'][(Math.round(Math.atan2(z, x) / (Math.PI / 4)) + 8) % 8];
}

/** Read-only command submitted to physics, rather than the resulting velocity. */
export function RobotControlMonitor({ control, robot, phase, time }: { control: RobotControlSnapshot; robot: DuelRobot; phase: DuelPhase; time: number }) {
  const { command, hasDecision } = control;
  const { x, z } = command.move;
  const strength = Math.min(1, Math.hypot(x, z));
  const blocked = phase === 'running' && hasDecision && strength > .2 && Math.hypot(robot.vx, robot.vz) < .05;
  const shot = control.shotAt !== null && time - control.shotAt < .25;
  const cover = control.coverAt !== null && time - control.coverAt < .25;
  const fireStatus = shot ? 'Atış çıktı' : robot.carrying ? 'Siper taşınıyor' : robot.cooldown > .01 ? `${robot.cooldown.toFixed(1)} sn bekle` : command.fire ? 'Atış isteği' : 'İstek yok';
  const coverStatus = robot.carrying ? 'Taşıyor' : cover ? 'Bıraktı' : command.interact ? 'İstek açık' : 'İstek yok';
  return <section className="robot-control-monitor" data-testid="robot-control-monitor" aria-label="Robotun canlı kontrol kararları">
    <div className="robot-movement-readout">
      <div className="robot-stick" role="img" aria-label={`Hareket isteği: ${directionName(x, z)}, yüzde ${Math.round(strength * 100)}`}>
        <span className="robot-stick-ring" />
        <span className="robot-stick-knob" data-testid="robot-move-knob" data-x={x.toFixed(4)} data-z={z.toFixed(4)} style={{ transform: `translate(-50%, -50%) translate(${x * 23}px, ${z * 23}px)` }} />
      </div>
      <div className="robot-movement-copy"><span>{phase === 'running' ? 'MODEL KONTROLÜ' : 'SON KOMUT'}</span><strong data-testid="robot-move-label">{hasDecision ? directionName(x, z) : 'Karar bekleniyor'} <small>{hasDecision ? `${Math.round(strength * 100)}%` : ''}</small></strong><small>{blocked ? <span data-testid="robot-blocked">Hareket engellendi</span> : `X ${x.toFixed(2)} · Z ${z.toFixed(2)}`}</small></div>
    </div>
    <div className="robot-command-readouts">
      <div className="robot-command robot-command-fire" data-testid="robot-fire-command" data-requested={hasDecision && command.fire} data-executed={shot} aria-label={`Ateş komutu ${command.fire ? 'açık' : 'kapalı'}. ${fireStatus}`}><div><Crosshair size={15} /><strong>Ateş</strong><i /></div><small>{fireStatus}</small><span className="robot-command-reload" aria-hidden="true"><span style={{ width: `${(1 - Math.min(1, robot.cooldown / SHOT_COOLDOWN)) * 100}%` }} /></span></div>
      <div className="robot-command robot-command-cover" data-testid="robot-cover-command" data-requested={hasDecision && command.interact} data-executed={cover} aria-label={`Al bırak komutu ${command.interact ? 'açık' : 'kapalı'}. ${coverStatus}`}><div><Box size={15} /><strong>Al / bırak</strong><i /></div><small>{coverStatus}</small></div>
    </div>
  </section>;
}
