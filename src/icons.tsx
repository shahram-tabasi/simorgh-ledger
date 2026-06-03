// آیکون‌های خطیِ تک‌رنگ (سیاه‌وسفیدِ باکلاس) برای منوها و پنل‌ها
import type { ReactNode } from 'react';

const S = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const IconReport = () => S(<>
  <path d="M4 19V5" /><path d="M4 19h16" />
  <rect x="7" y="11" width="2.6" height="5" /><rect x="12" y="8" width="2.6" height="8" /><rect x="17" y="13" width="2.6" height="3" />
</>);

export const IconBom = () => S(<>
  <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17" /><path d="M8 3v3M16 3v3" />
  <path d="M8.5 14.5l2 2 4-4" />
</>);

export const IconLoan = () => S(<>
  <rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3 10h18" /><path d="M6.5 14.5h4" />
</>);

export const IconConvert = () => S(<>
  <path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" />
</>);

export const IconAge = () => S(<>
  <path d="M5 20h14v-7H5z" /><path d="M4 20h16" /><path d="M7 13v-2.5a5 5 0 0 1 10 0V13" />
  <path d="M12 5.5V3" /><circle cx="12" cy="2.4" r="0.6" fill="currentColor" />
</>);

export const IconBio = () => S(<>
  <path d="M3 12h4l2.5 6 4-13L16 12h5" />
</>);

export const IconBmi = () => S(<>
  <path d="M5 19a7 7 0 0 1 14 0z" /><path d="M3.5 19h17" /><path d="M12 19l3-4.5" />
</>);

export const IconToday = () => S(<>
  <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17" /><path d="M8 3v3M16 3v3" />
  <circle cx="12" cy="14.5" r="2.2" />
</>);

export const IconUsers = () => S(<>
  <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
  <path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17 13.5a5.5 5.5 0 0 1 3.5 5.5" />
</>);

export const IconShare = () => S(<>
  <circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" />
  <path d="M8.1 10.9l7.3-3.8M8.1 13.1l7.3 3.8" />
</>);

export const IconGlobe = () => S(<>
  <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.5 2.3 2.5 14.7 0 17M12 3.5c-2.5 2.3-2.5 14.7 0 17" />
</>);

export const IconMenu = () => S(<><path d="M4 7h16M4 12h16M4 17h16" /></>);

export const IconInfo = () => S(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></>);
