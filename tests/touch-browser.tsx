import { createRoot } from 'react-dom/client';
import { useCallback, useRef, useState } from 'react';
import { TouchControls } from '../src/TouchControls';
import '../src/index.css';

function Fixture() {
  const ref = useRef<HTMLDivElement>(null);
  const [move, setMove] = useState({ x: 0, z: 0 });
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [mine, setMine] = useState(false);
  const [jump, setJump] = useState(false);
  const [sprint, setSprint] = useState(false);
  const [active, setActive] = useState(true);
  const onMove = useCallback((x: number, z: number) => setMove({ x, z }), []);
  const onLook = useCallback((x: number, y: number) => setLook({ x, y }), []);
  function event(label: string, type: string, id: number, dx = 0, dy = 0) {
    const element = ref.current!.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    const bounds = element.getBoundingClientRect();
    // Synthetic events cannot own real OS pointer capture. Stub capture only in this test fixture.
    element.setPointerCapture = () => {};
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
      clientX: bounds.left + bounds.width / 2 + dx, clientY: bounds.top + bounds.height / 2 + dy }));
  }
  return <main className="p-2 text-sm">
    <p>検証専用: OSの指入力・captureを置換した合成イベント。本体のセーブには触れません。</p>
    <nav className="flex gap-2 my-2">
      <button className="border p-2 min-h-11" disabled={!active} onClick={() => {
        event('移動スティック', 'pointerdown', 100, 0, -42);
        event('視点をドラッグ', 'pointerdown', 101);
        event('視点をドラッグ', 'pointermove', 101, 30, 15);
        event('採掘 / 攻撃', 'pointerdown', 102);
        event('ジャンプ', 'pointerdown', 103);
      }}>同時押しを実行</button>
      <button className="border p-2 min-h-11" disabled={!active} onClick={() => event('採掘 / 攻撃', 'pointercancel', 999)}>別の指を解除</button>
      <button className="border p-2 min-h-11" disabled={!active} onClick={() => event('採掘 / 攻撃', 'pointercancel', 102)}>採掘の指を解除</button>
      <button className="border p-2 min-h-11" onClick={() => setActive(false)}>全入力を停止</button>
    </nav>
    <output aria-live="polite">移動 x={move.x.toFixed(1)} z={move.z.toFixed(1)} / 視点 x={look.x} y={look.y} / 採掘{mine ? 'ON' : 'OFF'} / ジャンプ{jump ? 'ON' : 'OFF'} / 走る{sprint ? 'ON' : 'OFF'}</output>
    <div ref={ref} className="relative h-[400px] max-w-[900px] mt-2 border border-neutral-500 bg-emerald-950">
      <TouchControls active={active} onMove={onMove} onLook={onLook} onMine={setMine} onJump={setJump} onSprint={setSprint}
        onUse={() => {}} onMenu={() => setActive(false)} onPause={() => setActive(false)} />
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
