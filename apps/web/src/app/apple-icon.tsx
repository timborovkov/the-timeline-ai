import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: '#0a0e0d',
        padding: 24,
      }}
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%">
        <rect x="0" y="6" width="38" height="6" fill="#f5f5f5" />
        <rect x="0" y="16" width="27" height="6" fill="#f5f5f5" />
        <rect x="0" y="26" width="38" height="6" fill="#f5f5f5" />
        <rect x="0" y="36" width="32" height="6" fill="#f5f5f5" />
        <rect x="42" y="26" width="6" height="6" fill="#b5ea4a" />
      </svg>
    </div>,
    size,
  );
}
