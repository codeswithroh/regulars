import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, ArrowLeft } from 'lucide-react';
import { shopPath, type Shop } from '@regulars/contracts';
import '../styles/landing.css';
import { fmt } from '../components/kit';

export function Poster({ shop }: { shop: Shop }) {
  const link = `${location.origin}/#${shopPath(shop)}`;
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#241510', light: '#fff8f1' } }).then(setQr); }, [link]);
  const percent = Number((shop.redeem * 10000n) / shop.earn) / 100;
  return (
    <div className="poster-page">
      <div className="poster">
        <p className="l-eyebrow">(pay with bitcoin cash)</p>
        <h1>{shop.name}</h1>
        <p className="poster-lede"><em>{percent}%</em> back on every payment</p>
        {qr && <img src={qr} alt={`QR code linking to ${shop.name}`} data-testid="poster-qr" />}
        <p className="poster-fine">Scan · connect your wallet · pay. 1 stamp per {fmt(shop.earn)} sats, redeemable for {fmt(shop.redeem)} sats each.</p>
        <div className="noprint" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="l-btn" onClick={() => window.print()}><Printer size={16} />Print</button>
          <a className="l-btn ghost" href={`#${shopPath(shop)}`}><ArrowLeft size={16} />Shop</a>
        </div>
      </div>
    </div>
  );
}
