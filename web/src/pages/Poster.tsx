import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { shopPath, type Shop } from '@regulars/contracts';
import { cashbackPercent, sats } from '../ui';

export function Poster({ shop }: { shop: Shop }) {
  const link = `${location.origin}/#${shopPath(shop)}`;
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 520, errorCorrectionLevel: 'M' }).then(setQr); }, [link]);
  return (
    <section className="poster">
      <p className="eyebrow">Pay with Bitcoin Cash</p>
      <h1>{shop.name}</h1>
      <p className="lede">Get <strong>{cashbackPercent(shop)}% back</strong> on every payment.</p>
      {qr && <img src={qr} alt={`QR code linking to ${shop.name}`} data-testid="poster-qr" />}
      <p className="muted">Scan, connect your wallet, pay. 1 stamp per {sats(shop.earn)}, redeemable for {sats(shop.redeem)} each.</p>
      <button className="noprint" onClick={() => window.print()}>Print</button>
    </section>
  );
}
