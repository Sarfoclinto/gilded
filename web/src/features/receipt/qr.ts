import qrcode from "qrcode-generator";

/**
 * What the QR code says. The paying desk will scan it to open the purchase (the full pay-from-receipt flow comes with the
 * two-step payout). It carries no money figures a stranger could use: just which purchase this is.
 */
export function receiptPayload(t: {
  id: string;
  reference: string | null;
}): string {
  return `gilded:tx:${t.id}${t.reference ? `:${t.reference}` : ""}`;
}

export interface QrMatrix {
  size: number;
  /** Row-major; true is a dark module. */
  dark: boolean[];
}

export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const dark: boolean[] = [];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) dark.push(qr.isDark(r, c));
  return { size, dark };
}

/** One SVG path for all dark modules, so it prints sharp at any size. */
export function qrPath(m: QrMatrix): string {
  let d = "";
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark[r * m.size + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && m.dark[r * m.size + c]) c++;
      d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  return d;
}
