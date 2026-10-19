import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from './types';
import './floating-joystick.css';

interface JoystickProps {
  onMove: (move: Vec2) => void;
  disabled?: boolean;
  /** Clear a captured gesture when the surrounding game clears its controls. */
  resetKey?: number;
}

const restingPosition = {
  x: 0, y: 0, moveX: 0, moveZ: 0, left: 0, top: 0, originX: 0, originY: 0, active: false,
};

/** The first finger on the left half owns movement; the right half remains free to fire. */
export function Joystick({ onMove, disabled = false, resetKey = 0 }: JoystickProps) {
  const host = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0, radius: 1, left: 0, top: 0 });
  const moveCallback = useRef(onMove);
  moveCallback.current = onMove;
  const [position, setPosition] = useState(restingPosition);

  const release = useCallback(() => {
    const id = pointer.current;
    // Clear ownership before releasing capture: lostpointercapture may fire immediately.
    pointer.current = null;
    if (id !== null && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
    moveCallback.current({ x: 0, z: 0 });
    setPosition(restingPosition);
  }, []);

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointer.current) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - origin.current.x) / origin.current.radius;
    const dz = (event.clientY - origin.current.y) / origin.current.radius;
    const distance = Math.hypot(dx, dz);
    const clamped = Math.min(distance, 1);
    const x = distance ? dx / distance : 0;
    const z = distance ? dz / distance : 0;
    // Preserve the continuous analog input and its 12% center dead zone.
    const strength = Math.max(0, (clamped - .12) / .88);
    const move = { x: x * strength, z: z * strength };
    moveCallback.current(move);
    setPosition({
      x: x * clamped * origin.current.radius,
      y: z * clamped * origin.current.radius,
      moveX: move.x,
      moveZ: move.z,
      left: origin.current.left,
      top: origin.current.top,
      originX: origin.current.x,
      originY: origin.current.y,
      active: true,
    });
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Another finger releasing a shot must never stop the movement finger.
    if (event.pointerId !== pointer.current) return;
    event.preventDefault();
    event.stopPropagation();
    release();
  };

  useEffect(() => {
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release);
    window.addEventListener('resize', release);
    window.addEventListener('orientationchange', release);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('resize', release);
      window.removeEventListener('orientationchange', release);
      document.removeEventListener('visibilitychange', visibility);
      const id = pointer.current;
      pointer.current = null;
      if (id !== null && host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id);
      moveCallback.current({ x: 0, z: 0 });
    };
  }, [release]);
  useEffect(() => { if (disabled) release(); }, [disabled, release]);
  useEffect(() => { release(); }, [resetKey, release]);

  return <div ref={host} className="movement-zone" data-testid="movement-zone"
    data-active={position.active} role="group" aria-label="Hareket alanı"
    aria-describedby="joystick-instructions" aria-disabled={disabled}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // Keep the left half reserved for movement even while controls are disabled.
      if (disabled || pointer.current !== null) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const ringBounds = ring.current!.getBoundingClientRect();
      const thumbBounds = thumb.current!.getBoundingClientRect();
      origin.current = {
        x: event.clientX,
        y: event.clientY,
        radius: Math.max(1, (ringBounds.width - thumbBounds.width) / 2 - 5),
        left: event.clientX - bounds.left,
        top: event.clientY - bounds.top,
      };
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      // Touching the field defines a neutral origin; direction starts with dragging.
      drag(event);
    }}
    onPointerMove={drag}
    onPointerUp={endGesture}
    onPointerCancel={endGesture}
    onLostPointerCapture={endGesture}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div ref={ring} className={`movement-joystick ${position.active ? 'is-active' : ''}`}
      data-testid="movement-joystick" data-active={position.active}
      data-move-x={position.moveX.toFixed(4)} data-move-z={position.moveZ.toFixed(4)}
      data-origin-x={position.originX} data-origin-y={position.originY}
      aria-hidden="true" style={{ left: position.left, top: position.top }}>
      <span className="joystick-orbit" />
      <span ref={thumb} className="joystick-thumb" style={{ transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)` }}><span /></span>
    </div>
    <span id="joystick-instructions" className="control-sr-only">Hareket etmek için arenanın sol tarafında bir yere dokunup sürükle. Dokunduğun nokta hareketin başlangıcı olur. Bırakınca durursun. Klavyede WASD veya yön tuşlarını kullanabilirsin.</span>
  </div>;
}
