// Client for the remote-scanner relay (phone ⇄ server ⇄ desktop).
// Desktop generates a 6-digit channel and polls it; the phone joins the channel and pushes scans.
export const relayBase = () => localStorage.getItem('apiBase') || 'https://ledger.simorghai.com';

export const genChannel = () => String(Math.floor(100000 + Math.random() * 900000));

// Phone side: push one scanned barcode into the channel. Returns false on network failure.
export async function sendScan(channel: string, code: string): Promise<boolean> {
  try {
    const r = await fetch(`${relayBase()}/api/scan/${channel}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    return r.ok;
  } catch { return false; }
}

// Desktop side: fetch scans newer than `after`; returns new scans + the new cursor.
export async function pollScans(channel: string, after: number): Promise<{ scans: { id: number; code: string }[]; last: number }> {
  try {
    const r = await fetch(`${relayBase()}/api/scan/${channel}?after=${after}`);
    if (!r.ok) return { scans: [], last: after };
    return await r.json();
  } catch { return { scans: [], last: after }; }
}

// Attendance-device relay: poll punch logs pushed by external face/fingerprint/card devices.
export interface AttLog { id: number; code: string; time?: string; dir?: 'in' | 'out' }
export async function pollAtt(channel: string, after: number): Promise<{ logs: AttLog[]; last: number }> {
  try {
    const r = await fetch(`${relayBase()}/api/att/${channel}?after=${after}`);
    if (!r.ok) return { logs: [], last: after };
    return await r.json();
  } catch { return { logs: [], last: after }; }
}
