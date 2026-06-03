// راهنمای نصب اول + پنجره‌ی تغییرات نسخه
import { useState } from 'react';
import logoUrl from './assets/logo.png';

interface Slide { icon?: string; logo?: boolean; title: string; text: string; }

const SLIDES: Slide[] = [
  { logo: true, title: 'به simorgh-ledger خوش آمدید', text: 'دفترکل و تقویمِ هوشمندِ سیمرغ؛ شمسی، میلادی و قمری در یک‌جا.' },
  { icon: '📅', title: 'سه تقویم در کنار هم', text: 'با دکمه‌های بالای صفحه بین تقویمِ شمسی، میلادی و قمری جابه‌جا شوید. تاریخِ امروز در هر سه نمایش داده می‌شود.' },
  { icon: '💰', title: 'ثبت بدهی و قسط', text: 'روی هر روز بزنید و تراکنش اضافه کنید. مبلغِ هر قسط را همان لحظه یا بعداً می‌توانید ویرایش کنید.' },
  { icon: '👆', title: 'منوها', text: 'انگشت را روی صفحه به چپ یا راست بکشید، یا از دکمه‌های بالا استفاده کنید: یک طرف «ابزارها» و طرف دیگر «درباره و پوسته».' },
  { icon: '💳', title: 'وام و اقساط', text: 'مبلغ وام، نرخ سود و تعداد اقساط را وارد کنید؛ برنامه خودش اقساط را روی تاریخِ سررسید در تقویم می‌چیند.' },
  { icon: '🕌', title: 'اوقات شرعی و پوسته', text: 'اوقات شرعی بر اساس استان و شهرِ شما (آفلاین)، و انتخابِ پوسته‌ی روشن یا تیره.' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  return (
    <div className="onb">
      <button className="onb-skip" onClick={onDone}>رد کردن</button>
      <div className="onb-card" key={i}>
        {s.logo ? <img className="onb-logo" src={logoUrl} alt="" /> : <div className="onb-icon">{s.icon}</div>}
        <h2 className="onb-title">{s.title}</h2>
        <p className="onb-text">{s.text}</p>
      </div>
      <div className="onb-bottom">
        <div className="onb-dots">
          {SLIDES.map((_, k) => <span key={k} className={`onb-dot ${k === i ? 'active' : ''}`} />)}
        </div>
        <button className="onb-next" onClick={() => (last ? onDone() : setI(i + 1))}>
          {last ? 'شروع می‌کنیم' : 'بعدی'}
        </button>
      </div>
    </div>
  );
}

export function WhatsNew({ version, items, onClose }: { version: string; items: string[]; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box wn-box" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <span className="tool-panel-icon">✨</span>
          <h3>تازه‌های نسخه {version}</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="wn-body">
          <ul className="wn-list">
            {items.map((t, k) => <li key={k}>{t}</li>)}
          </ul>
          <button className="wn-ok" onClick={onClose}>متوجه شدم</button>
        </div>
      </div>
    </div>
  );
}
