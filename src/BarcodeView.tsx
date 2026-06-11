// Shared inline SVG barcode (Code39) — used for inventory labels and employee badge cards.
import { code39Bars } from './barcode';

export default function Barcode({ value, height = 48 }: { value: string; height?: number }) {
  const { bars, width } = code39Bars(value);
  if (!value) return null;
  return (
    <svg className="inv-barcode" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={value}>
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}
