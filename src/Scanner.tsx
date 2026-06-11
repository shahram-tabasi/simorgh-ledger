// Shared camera barcode scanner (turns the phone into a scanner). Uses ZXing, which decodes 1D/2D
// barcodes from camera frames in pure JS — so it works in the Android app WebView too, not only
// browsers with BarcodeDetector. The mobile app requests CAMERA permission natively (MainActivity).
import { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';

export default function CameraScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cbRef = useRef(onResult); cbRef.current = onResult;
  const [err, setErr] = useState('');
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null; let done = false;
    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, _e, ctrls) => {
          if (result && !done) { done = true; ctrls.stop(); cbRef.current(result.getText().trim()); }
        });
      } catch {
        setErr('دسترسی به دوربین ممکن نشد. اجازه‌ی دوربین را بدهید، یا از اسکنرِ سخت‌افزاری/واردکردنِ دستی استفاده کنید.');
      }
    })();
    return () => { done = true; try { controls?.stop(); } catch { /* ignore */ } };
  }, []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box inv-cam" onClick={(e) => e.stopPropagation()}>
        <div className="tool-panel-head"><span /><h3>اسکنِ بارکد با دوربین</h3><button className="close-modal" onClick={onClose}>✕</button></div>
        {err ? <div className="tool-note" style={{ padding: 16 }}>{err}</div> : <video ref={videoRef} className="inv-cam-video" playsInline muted />}
        <div className="tool-note" style={{ padding: '8px 12px' }}>بارکد را مقابلِ دوربین بگیرید؛ پس از تشخیص خودکار بسته می‌شود.</div>
      </div>
    </div>
  );
}
