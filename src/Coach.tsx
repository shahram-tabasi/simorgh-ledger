// راهنمای تصویری (Spotlight/Coach): هر بار یک عنصر روشن می‌شود و توضیحش می‌آید
import { useEffect, useState } from 'react';

export interface CoachStep { selector: string; title: string; text: string; }

export default function CoachTour({ steps, onClose }: { steps: CoachStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector(steps[i].selector) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const t = setTimeout(() => setRect(el.getBoundingClientRect()), 180);
    return () => clearTimeout(t);
  }, [i, steps]);

  const step = steps[i];
  const last = i === steps.length - 1;
  const pad = 8;
  const box = rect
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }
    : null;

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const below = !rect || rect.bottom + 180 < vh;
  const tipStyle: React.CSSProperties = rect
    ? (below
        ? { top: rect.bottom + pad + 14, left: 16, right: 16 }
        : { bottom: vh - rect.top + pad + 14, left: 16, right: 16 })
    : { top: '50%', left: 16, right: 16, transform: 'translateY(-50%)' };

  return (
    <div className="coach">
      {box && <div className="coach-hole" style={box} />}
      <div className="coach-tip" style={tipStyle}>
        <div className="coach-step">{i + 1} از {steps.length}</div>
        <div className="coach-title">{step.title}</div>
        <div className="coach-text">{step.text}</div>
        <div className="coach-btns">
          <button className="coach-skip" onClick={onClose}>رد کردن</button>
          <div className="coach-nav">
            {i > 0 && <button className="coach-prev" onClick={() => setI(i - 1)}>قبلی</button>}
            <button className="coach-next" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'تمام' : 'بعدی'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
