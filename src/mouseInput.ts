/** The canvas must also be the PointerLockControls / requestPointerLock target. */
export function bindGameMouse(
  canvas: EventTarget,
  releaseTarget: EventTarget,
  canAct: () => boolean,
  onPrimary: (held: boolean) => void,
  onUse: () => void,
) {
  // Pointer Lock guarantees MouseEvents. mousedown also reports a second button
  // pressed while another is held; pointerdown only reports the first button.
  const down = (event: Event) => {
    if (!canAct()) return;
    const { button } = event as MouseEvent;
    if (button === 0) onPrimary(true);
    else if (button === 2) onUse();
  };
  const up = (event: Event) => {
    if ((event as MouseEvent).button === 0) onPrimary(false);
  };
  const cancel = () => onPrimary(false);
  canvas.addEventListener('mousedown', down);
  releaseTarget.addEventListener('mouseup', up);
  releaseTarget.addEventListener('pointercancel', cancel);
  releaseTarget.addEventListener('blur', cancel);
  return () => {
    canvas.removeEventListener('mousedown', down);
    releaseTarget.removeEventListener('mouseup', up);
    releaseTarget.removeEventListener('pointercancel', cancel);
    releaseTarget.removeEventListener('blur', cancel);
    cancel();
  };
}
