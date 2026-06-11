// Pure-JS Code39 barcode generator — no external dependencies, works fully offline.
// Code39 is simple and reliably scanned by cheap scanners and phone cameras.
// Each character maps to 9 elements (5 bars + 4 spaces), alternating bar/space, 3 of which are wide.
const CODE39: { [c: string]: string } = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
  'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
  'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
  'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

// Sanitize text to the Code39 alphabet (uppercase alphanumerics + a few symbols).
export const cleanBarcode = (s: string) => (s || '').toUpperCase().replace(/[^0-9A-Z\-. ]/g, '');

// Compute the filled-bar rectangles for a Code39 rendering of `text`.
export function code39Bars(text: string, narrow = 2, wide = 6): { bars: { x: number; w: number }[]; width: number } {
  const seq = `*${cleanBarcode(text)}*`;
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let k = 0; k < seq.length; k++) {
    const pat = CODE39[seq[k]] || CODE39['*'];
    for (let e = 0; e < 9; e++) {
      const w = pat[e] === 'w' ? wide : narrow;
      if (e % 2 === 0) bars.push({ x, w }); // even element index = bar (odd = space)
      x += w;
    }
    x += narrow; // inter-character narrow space
  }
  return { bars, width: x };
}

// Generate a fresh numeric barcode (Code39-safe). Prefix lets a company brand its codes.
export function genBarcode(prefix = '2'): string {
  return prefix + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 10));
}
