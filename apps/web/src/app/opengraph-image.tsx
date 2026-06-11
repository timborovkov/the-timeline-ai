import { ImageResponse } from 'next/og';

export const alt = 'The Timeline — the operations log your team can talk to';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0a0e0d',
        color: '#f5f5f5',
        padding: '64px 72px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top strip — mono index */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 18,
          letterSpacing: '0.18em',
          color: '#7a8278',
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          textTransform: 'uppercase',
        }}
      >
        <span>THE TIMELINE · OPERATIONAL ARCHIVE · v1</span>
        <span>thetimeline.cc</span>
      </div>

      {/* Hero block — mark + headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
        <svg viewBox="0 0 48 48" width="240" height="240">
          <rect x="0" y="6" width="38" height="6" fill="#f5f5f5" />
          <rect x="0" y="16" width="27" height="6" fill="#f5f5f5" />
          <rect x="0" y="26" width="38" height="6" fill="#f5f5f5" />
          <rect x="0" y="36" width="32" height="6" fill="#f5f5f5" />
          <rect x="42" y="26" width="6" height="6" fill="#b5ea4a" />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              color: '#f5f5f5',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Nobody updates</span>
            <span>
              the CRM. <span style={{ color: '#b5ea4a' }}>The Timeline</span>
            </span>
            <span>updates itself.</span>
          </div>
        </div>
      </div>

      {/* Bottom strip — eyebrow */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 18,
          letterSpacing: '0.18em',
          color: '#7a8278',
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          textTransform: 'uppercase',
        }}
      >
        <span>INDEXED · CITED · NEVER FORGOTTEN</span>
        <span>[ev:0001]</span>
      </div>
    </div>,
    size,
  );
}
