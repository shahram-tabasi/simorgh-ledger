// Access control (roles): groups + permissions + users, with an "active user" that gates the UI.
// Design note: this is DEVICE-SIDE role separation (e.g. a shared phone/tablet), protected by an
// admin PIN — NOT real multi-device security. Server-enforced auth/permissions is the next step.
// Key idea the owner asked for: define GROUPS with permissions, then put USERS into groups
// (no need to set permissions per worker).
import { useState } from 'react';

// Permission catalog. Each key gates a feature/menu item in App.tsx via `can(key)`.
export const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'fund', label: 'صندوقِ قرض‌الحسنه' },
  { key: 'loans', label: 'وام' },
  { key: 'accounting', label: 'حسابداری' },
  { key: 'inventory', label: 'انبار' },
  { key: 'attendance', label: 'حضور و غیاب (مدیریت کامل)' },
  { key: 'attendance_self', label: 'حضور و غیابِ شخصی (کارگر)' },
  { key: 'tools', label: 'ابزار و گزارش‌ها' },
  { key: 'users', label: 'مدیریتِ کاربران و دسترسی' },
];
const ALL_PERMS = PERMISSIONS.map((p) => p.key);

export interface Group { id: string; name: string; perms: string[]; }
export interface AppUser { id: string; name: string; groupId: string; empId?: string; } // empId links to an attendance employee
export interface AccessState { enabled: boolean; pin: string; groups: Group[]; users: AppUser[]; activeUserId: string | null; }

export function emptyAccess(): AccessState {
  return {
    enabled: false,
    pin: '',
    groups: [
      { id: 'g-admin', name: 'مدیر', perms: [...ALL_PERMS] },
      { id: 'g-worker', name: 'کارگر', perms: ['attendance_self'] },
    ],
    users: [],
    activeUserId: null,
  };
}

interface Props {
  state: AccessState;
  onChange: (s: AccessState) => void;
  onClose: () => void;
  confirm: (msg: string, onYes: () => void) => void;
  employees: { id: string; name: string }[];  // from attendance, to link a user to an employee
  requirePin?: boolean;                        // when true, ask the admin PIN before showing content
}
type Tab = 'users' | 'groups' | 'settings';

export default function AccessPanel({ state, onChange, onClose, confirm, employees, requirePin }: Props) {
  const groups = state.groups || [];
  const users = state.users || [];
  const [tab, setTab] = useState<Tab>('users');
  // PIN gate: a non-admin active user must enter the admin PIN to open this management screen.
  const [unlocked, setUnlocked] = useState(!(requirePin && state.pin));
  const [pinTry, setPinTry] = useState('');
  if (!unlocked) {
    return (
      <div className="modal" onClick={onClose}>
        <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tool-panel-head">
            <button className="close-modal" onClick={onClose}>‹</button>
            <h3>🔒 رمزِ مدیر</h3>
            <button className="close-modal" onClick={onClose}>✕</button>
          </div>
          <div className="tool-panel-body">
            <label className="field-label">برای ورود به مدیریتِ کاربران، رمزِ مدیر را وارد کنید</label>
            <input className="tool-text-input" type="password" inputMode="numeric" dir="ltr" value={pinTry} onChange={(e) => setPinTry(e.target.value.replace(/[^0-9]/g, ''))} />
            <button className="loan-submit" onClick={() => { if (pinTry === state.pin) setUnlocked(true); else confirm('رمز اشتباه است.', () => {}); }}>ورود</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- users ----------
  const [uName, setUName] = useState(''); const [uGroup, setUGroup] = useState(groups[0]?.id || ''); const [uEmp, setUEmp] = useState('');
  const addUser = () => {
    if (!uName.trim() || !uGroup) return;
    const u: AppUser = { id: `u-${Date.now()}`, name: uName.trim(), groupId: uGroup, empId: uEmp || undefined };
    onChange({ ...state, users: [...users, u] }); setUName(''); setUEmp('');
  };
  const delUser = (id: string) => confirm('این کاربر حذف شود؟', () => onChange({ ...state, users: users.filter((u) => u.id !== id), activeUserId: state.activeUserId === id ? null : state.activeUserId }));
  const setActive = (id: string | null) => onChange({ ...state, activeUserId: id });

  // ---------- groups ----------
  const [gName, setGName] = useState(''); const [gPerms, setGPerms] = useState<string[]>([]);
  const togglePerm = (k: string) => setGPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);
  const addGroup = () => {
    if (!gName.trim()) return;
    const g: Group = { id: `g-${Date.now()}`, name: gName.trim(), perms: [...gPerms] };
    onChange({ ...state, groups: [...groups, g] }); setGName(''); setGPerms([]);
  };
  const delGroup = (id: string) => {
    if (users.some((u) => u.groupId === id)) { confirm('این گروه کاربر دارد و حذف نمی‌شود.', () => {}); return; }
    confirm('این گروه حذف شود؟', () => onChange({ ...state, groups: groups.filter((g) => g.id !== id) }));
  };
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name || '—';

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box tool-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head">
          <button className="close-modal" onClick={onClose}>‹</button>
          <h3>👤 کاربران و دسترسی</h3>
          <button className="close-modal" onClick={onClose}>✕</button>
        </div>
        <div className="tool-panel-body">
          <div className="mini-toggle fund-tabs">
            <button type="button" className={`mini-toggle-btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>کاربران</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'groups' ? 'active' : ''}`} onClick={() => setTab('groups')}>گروه‌ها</button>
            <button type="button" className={`mini-toggle-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>تنظیمات</button>
          </div>

          {/* ---------------- users ---------------- */}
          {tab === 'users' && (
            <>
              <div className="loan-sched-head"><span>افزودنِ کاربر</span></div>
              <input className="tool-text-input" type="text" placeholder="نامِ کاربر" value={uName} onChange={(e) => setUName(e.target.value)} />
              <label className="field-label">گروه (سطحِ دسترسی)</label>
              <select className="tool-text-input" value={uGroup} onChange={(e) => setUGroup(e.target.value)}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <label className="field-label">اتصال به کارمند (برای حالتِ کارگر، اختیاری)</label>
              <select className="tool-text-input" value={uEmp} onChange={(e) => setUEmp(e.target.value)}>
                <option value="">— بدون اتصال —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button className="loan-submit" disabled={!uName.trim()} onClick={addUser}>افزودنِ کاربر</button>

              <div className="loan-sched-head"><span>فهرستِ کاربران</span><span className="loan-sched-hint">{users.length} نفر</span></div>
              <div className="loan-detail-list">
                {users.map((u) => (
                  <div key={u.id} className={`loan-detail-row ${state.activeUserId === u.id ? 'paid' : ''}`}>
                    <div className="ld-info">
                      <span className="ld-amt">{u.name} <span className="fm-shares">{groupName(u.groupId)}</span></span>
                      <span className="ld-date">{state.activeUserId === u.id ? 'کاربرِ فعال ✓' : 'برای فعال‌کردن بزنید'}</span>
                    </div>
                    <button className="fm-notify" title="کاربرِ فعال" onClick={() => setActive(u.id)}>▶</button>
                    <button className="fm-notify" title="حذف" onClick={() => delUser(u.id)}>🗑</button>
                  </div>
                ))}
              </div>
              {state.activeUserId && <button className="acc-addline" onClick={() => setActive(null)}>بازگشت به حالتِ مدیر (بدونِ کاربرِ فعال)</button>}
            </>
          )}

          {/* ---------------- groups ---------------- */}
          {tab === 'groups' && (
            <>
              <div className="loan-sched-head"><span>گروهِ جدید</span></div>
              <input className="tool-text-input" type="text" placeholder="نامِ گروه (مثلاً حسابدار)" value={gName} onChange={(e) => setGName(e.target.value)} />
              <label className="field-label">دسترسی‌ها</label>
              <div className="acc-perms">
                {PERMISSIONS.map((perm) => (
                  <label key={perm.key} className="fund-switch acc-perm">
                    <input type="checkbox" checked={gPerms.includes(perm.key)} onChange={() => togglePerm(perm.key)} />
                    <span>{perm.label}</span>
                  </label>
                ))}
              </div>
              <button className="loan-submit" disabled={!gName.trim()} onClick={addGroup}>افزودنِ گروه</button>

              <div className="loan-sched-head"><span>گروه‌ها</span><span className="loan-sched-hint">{groups.length} گروه</span></div>
              <div className="loan-detail-list">
                {groups.map((g) => (
                  <div key={g.id} className="loan-detail-row">
                    <div className="ld-info">
                      <span className="ld-amt">{g.name}</span>
                      <span className="ld-date">{g.perms.length ? g.perms.map((k) => PERMISSIONS.find((p) => p.key === k)?.label).join('، ') : 'بدون دسترسی'}</span>
                    </div>
                    <button className="fm-notify" title="حذف" onClick={() => delGroup(g.id)}>🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ---------------- settings ---------------- */}
          {tab === 'settings' && (
            <>
              <label className="fund-switch">
                <input type="checkbox" checked={state.enabled} onChange={(e) => onChange({ ...state, enabled: e.target.checked })} />
                <span>فعال‌سازیِ کنترلِ دسترسی</span>
              </label>
              <label className="field-label">رمزِ مدیر (برای ورود به این بخش وقتی کنترل فعال است)</label>
              <input className="tool-text-input" type="text" inputMode="numeric" dir="ltr" placeholder="مثلاً 1234" value={state.pin} onChange={(e) => onChange({ ...state, pin: e.target.value.replace(/[^0-9]/g, '') })} />
              <div className="tool-note">
                وقتی کنترلِ دسترسی روشن باشد، فقط امکاناتِ گروهِ «کاربرِ فعال» نمایش داده می‌شود.
                ورود به همین بخش رمزِ مدیر می‌خواهد. این کنترل سمتِ دستگاه است؛ امنیتِ کاملِ چنددستگاهه در نسخه‌ی سرور می‌آید.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
