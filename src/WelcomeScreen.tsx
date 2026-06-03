// صفحه‌ی خوش‌آمد با لوگوی کامل، هنگام باز شدن برنامه
import { useEffect, useState } from 'react';
import logoUrl from './assets/logo.png';

export default function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    setLeaving(true);
    setTimeout(onDone, 450);
  };

  useEffect(() => {
    const t = setTimeout(close, 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`welcome ${leaving ? 'leaving' : ''}`} onClick={close}>
      <div className="welcome-inner">
        <img className="welcome-logo" src={logoUrl} alt="simorgh-ledger" />
        <h1 className="welcome-title">simorgh-ledger</h1>
        <div className="welcome-sub">دفترکل و تقویم هوشمند سیمرغ</div>
        <div className="welcome-divider">— شمسی · میلادی · قمری —</div>
      </div>
      <div className="welcome-footer">
        <div>سیمرغ فناوری هوشمند ایرانیان</div>
        <div className="welcome-version">نسخه ۱۴۰۵ · www.simorghai.com</div>
      </div>
    </div>
  );
}
