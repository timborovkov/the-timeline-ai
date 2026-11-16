import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

export const alt = 'The Timeline — Your team’s work becomes a living record.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const [regular, semibold] = await Promise.all([
    readFile(join(process.cwd(), 'public/fonts/switzer/Switzer-Social-400.ttf')),
    readFile(join(process.cwd(), 'public/fonts/switzer/Switzer-Social-600.ttf')),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#080b07',
        color: '#f1f0e3',
        padding: '54px 64px',
        fontFamily: 'Switzer',
        fontWeight: 400,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 30, fontWeight: 600 }}
      >
        <svg viewBox="0 0 48 48" width="48" height="48">
          <rect x="0" y="6" width="38" height="6" fill="#f1f0e3" />
          <rect x="0" y="16" width="27" height="6" fill="#f1f0e3" />
          <rect x="0" y="26" width="38" height="6" fill="#f1f0e3" />
          <rect x="0" y="36" width="32" height="6" fill="#f1f0e3" />
          <rect x="42" y="26" width="6" height="6" fill="#b5f754" />
        </svg>
        <span>The Timeline</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 88,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: '-0.03em',
          }}
        >
          <span>Your team’s work.</span>
          <span style={{ color: '#b5f754' }}>A living record.</span>
        </div>
        <div style={{ fontSize: 30, color: '#b6baaa', display: 'flex' }}>
          Connected clients, projects, tasks and decisions.
        </div>
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, color: '#b6baaa' }}
      >
        <span>Sources attached. Changes you approve.</span>
        <span>thetimeline.cc</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Switzer', data: regular, weight: 400, style: 'normal' },
        { name: 'Switzer', data: semibold, weight: 600, style: 'normal' },
      ],
    },
  );
}
