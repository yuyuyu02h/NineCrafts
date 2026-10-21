import { useEffect, useRef, useState, type PointerEvent } from 'react';

export function joystickVector(dx: number, dy: number, radius = 42) {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  return { x: dx * scale / radius, z: dy * scale / radius };
}
function HoldButton({ label, onHold }: { label: string; onHold: (held: boolean) => void }) {
  const pointer = useRef<number | null>(null);
  useEffect(() => () => onHold(false), [onHold]);
  const release = (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null; onHold(false);
  };
  return <button aria-label={label} className="min-w-14 min-h-14 rounded-xl border border-white/30 bg-neutral-900/75 text-sm font-bold touch-none select-none active:bg-emerald-700"
    onContextMenu={e => e.preventDefault()}
    onPointerDown={e => { if (pointer.current !== null) return; e.preventDefault(); pointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); onHold(true); }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>{label}</button>;
}

interface Props {
  active: boolean;
  onMove: (x: number, z: number) => void;
  onLook: (dx: number, dy: number) => void;
  onMine: (held: boolean) => void;
  onJump: (held: boolean) => void;
  onSprint: (held: boolean) => void;
  onUse: () => void;
  onMenu: () => void;
  onPause: () => void;
  onFlight?: () => void;
}
export function TouchControls(p: Props) {
  const joystick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [stick, setStick] = useState({ x: 0, z: 0 });
  useEffect(() => {
    if (!p.active) { joystick.current = null; look.current = null; setStick({ x: 0, z: 0 }); p.onMove(0, 0); }
  }, [p.active, p.onMove]);
  if (!p.active) return null;
  const releaseStick = (e: PointerEvent<HTMLDivElement>) => {
    if (joystick.current?.id !== e.pointerId) return;
    joystick.current = null; setStick({ x: 0, z: 0 }); p.onMove(0, 0);
  };
  const releaseLook = (e: PointerEvent<HTMLDivElement>) => { if (look.current?.id === e.pointerId) look.current = null; };
  return <div data-touch-controls className="absolute inset-0 z-10 pointer-events-none select-none">
    <div aria-label="視点をドラッグ" className="absolute left-[42%] right-0 top-16 bottom-24 pointer-events-auto touch-none"
      onPointerDown={e => { if (look.current) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; }}
      onPointerMove={e => { const old = look.current; if (old?.id !== e.pointerId) return; p.onLook(e.clientX - old.x, e.clientY - old.y); old.x = e.clientX; old.y = e.clientY; }}
      onPointerUp={releaseLook} onPointerCancel={releaseLook} onLostPointerCapture={releaseLook} />
    <div aria-label="移動スティック" className="absolute left-[max(1rem,env(safe-area-inset-left))] bottom-[calc(6.5rem+env(safe-area-inset-bottom))] w-32 h-32 rounded-full border border-white/30 bg-neutral-900/40 pointer-events-auto touch-none"
      onPointerDown={e => {
        if (joystick.current) return;
        e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect();
        joystick.current = { id: e.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = joystickVector(e.clientX - joystick.current.x, e.clientY - joystick.current.y); setStick(v); p.onMove(v.x, v.z);
      }}
      onPointerMove={e => { const old = joystick.current; if (old?.id !== e.pointerId) return; const v = joystickVector(e.clientX - old.x, e.clientY - old.y); setStick(v); p.onMove(v.x, v.z); }}
      onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}>
      <span className="absolute left-1/2 top-1/2 w-12 h-12 -ml-6 -mt-6 rounded-full bg-white/45 pointer-events-none" style={{ transform: `translate(${stick.x * 38}px,${stick.z * 38}px)` }} />
    </div>
    <div className="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(6.5rem+env(safe-area-inset-bottom))] grid grid-cols-2 gap-2 pointer-events-auto">
      <HoldButton label="採掘 / 攻撃" onHold={p.onMine} />
      <button onClick={p.onUse} className="min-w-14 min-h-14 rounded-xl border border-white/30 bg-neutral-900/75 text-sm font-bold touch-manipulation">置く / 使う</button>
      <HoldButton label="走る / 下降" onHold={p.onSprint} />
      <HoldButton label="ジャンプ" onHold={p.onJump} />
    </div>
    <div className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 flex gap-2 pointer-events-auto">
      <button onClick={p.onMenu} className="min-h-11 px-3 rounded-lg bg-neutral-900/80 border border-white/30 text-xs">持ち物</button>
      <button onClick={p.onPause} className="min-h-11 px-3 rounded-lg bg-neutral-900/80 border border-white/30 text-xs">一時停止</button>
      {p.onFlight && <button onClick={p.onFlight} className="min-h-11 px-3 rounded-lg bg-neutral-900/80 border border-white/30 text-xs">飛行切替</button>}
    </div>
  </div>;
}
