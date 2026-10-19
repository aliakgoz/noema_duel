import { ChevronDown, Pause } from 'lucide-react';
import type { Level } from '../core/types';

export function RoomGuide({ level, onWait, disabled }: { level: Level; onWait: () => void; disabled: boolean }) {
  const rules: string[] = [];
  if (level.surfaces?.some(tile => tile.kind === 'ice')) rules.push('Buz: robot ve itilen kasa bir engele veya normal zemine kadar kayar.');
  if (level.surfaces?.some(tile => tile.kind === 'conveyor')) rules.push('Bant: her tuşta üzerindeki nesneyi ok yönünde taşır; Bekle ile de ilerletilebilir.');
  if (level.sequences?.length) rules.push('Sıralı anahtarlar: önlerine dönüp E ile numara sırasını izle. Yanlış sıra o grubu başa alır.');
  if (level.doors.some(door => door.logic === 'or')) rules.push('VEYA kapısı: bağlı anahtarlardan birinin açık olması yeterli.');
  if (level.doors.some(door => door.inverted)) rules.push('TERS kapı: bağlı koşulun tersiyle açılır.');
  return <div className="room-guide"><details><summary>Odanın kuralları <ChevronDown size={13}/></summary><p>{level.description}</p>{rules.map(rule => <p key={rule}>{rule}</p>)}</details>{level.surfaces?.some(tile => tile.kind === 'conveyor') && <button disabled={disabled} onClick={onWait} aria-label="Bekle"><Pause size={13}/> Bekle <kbd>Z</kbd></button>}</div>;
}
