import { banner } from '../config';

/** Required BLAZE banner, shown at the top of every page. */
export function Banner() {
  return (
    <div className="banner">
      <span>BCH BLAZE 2026</span>
      {banner.deck && <a href={banner.deck} target="_blank" rel="noreferrer">Presentation</a>}
      {banner.repo && <a href={banner.repo} target="_blank" rel="noreferrer">Source code</a>}
      {(banner.startDemo || banner.startCode) && (
        <span>Nov 14 start:{' '}
          {banner.startDemo && <a href={banner.startDemo} target="_blank" rel="noreferrer">demo</a>}
          {banner.startDemo && banner.startCode && ' · '}
          {banner.startCode && <a href={banner.startCode} target="_blank" rel="noreferrer">code</a>}
        </span>
      )}
      {banner.donation && <span>EMBER2026 votes: <code>{banner.donation}</code></span>}
    </div>
  );
}
