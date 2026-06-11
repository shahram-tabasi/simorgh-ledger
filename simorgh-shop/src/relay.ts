// Wireless-scanner relay client. The shop runs the bundled server on its laptop; the laptop POS and the
// phone both reach the SAME server (same origin / LAN), so relayBase is just the current origin.
export const relayBase = () => window.location.origin;

export const genChannel = () => String(Math.floor(100000 + Math.random() * 900000));

// Phone side: push a scanned barcode into the channel.
export async function sendScan(channel: string, code: string): Promise<boolean> {
  try {
    const r = await fetch(`${relayBase()}/api/scan/${channel}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    return r.ok;
  } catch { return false; }
}

// Laptop side: poll scans newer than `after`.
export async function pollScans(channel: string, after: number): Promise<{ scans: { id: number; code: string }[]; last: number }> {
  try {
    const r = await fetch(`${relayBase()}/api/scan/${channel}?after=${after}`);
    if (!r.ok) return { scans: [], last: after };
    return await r.json();
  } catch { return { scans: [], last: after }; }
}
