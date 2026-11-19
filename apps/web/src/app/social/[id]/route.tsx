import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { PUBLIC_SOCIAL_CARDS } from '@/lib/public-social-cards';

export const dynamic = 'force-static';
export const dynamicParams = false;

const cardAssets = Promise.all([
  readFile(join(process.cwd(), 'public/fonts/switzer/Switzer-Social-400.ttf')),
  readFile(join(process.cwd(), 'public/fonts/switzer/Switzer-Social-600.ttf')),
  readFile(join(process.cwd(), 'public/icons/icon-192.png'), 'base64'),
]);

export function generateStaticParams() {
  return PUBLIC_SOCIAL_CARDS.map(({ id }) => ({ id }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = PUBLIC_SOCIAL_CARDS.find((candidate) => candidate.id === id);
  if (!card) return new Response(null, { status: 404 });

  const [regular, semibold, brand] = await cardAssets;

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '54px 64px',
        color: '#f1f0e3',
        background: '#080b07',
        fontFamily: 'Switzer',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 28, fontWeight: 600 }}
      >
        <img alt="" width={42} height={42} src={`data:image/png;base64,${brand}`} />
        The Timeline
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 56 }}
      >
        <div
          style={{
            width: 560,
            fontSize: 73,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: '-0.04em',
          }}
        >
          {card.title}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 416,
            gap: 10,
            padding: 22,
            border: '1px solid #37402e',
            borderRadius: 18,
            background: '#11170f',
          }}
        >
          <div style={{ color: '#b5f754', margin: '2px 0 10px', fontSize: 22 }}>{card.label}</div>
          {card.steps.map((step, index) => (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 13px',
                borderRadius: 8,
                color: index === 2 ? '#b5f754' : '#f1f0e3',
                background: index === 2 ? '#26371a' : '#1b2217',
                fontSize: 24,
              }}
            >
              <span style={{ color: '#b5f754', width: 52, fontSize: 18 }}>
                {card.markers[index]}
              </span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: '#b6baaa' }}>thetimeline.cc</div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Switzer', data: regular, weight: 400, style: 'normal' },
        { name: 'Switzer', data: semibold, weight: 600, style: 'normal' },
      ],
    },
  );
}
