import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./records-to-answer.module.css', import.meta.url), 'utf8');

describe('records-to-answer motion contract', () => {
  it('keeps animated provenance properties to transforms and opacity', () => {
    const markerKeyframes = /@keyframes marker-pulse\s*\{(?<body>[\s\S]*?)\n\}/u.exec(styles);

    expect(markerKeyframes?.groups?.body).toContain('opacity:');
    expect(markerKeyframes?.groups?.body).toContain('transform:');
    expect(markerKeyframes?.groups?.body).not.toContain('box-shadow:');
    expect(styles).toContain('@media (prefers-reduced-motion: no-preference)');
  });

  it('keeps provenance labels at the documented technical-value size', () => {
    const timestamps = /\.record > span\s*\{(?<body>[\s\S]*?)\n\}/u.exec(styles);
    const citations = /\.citations > span\s*\{(?<body>[\s\S]*?)\n\}/u.exec(styles);

    expect(timestamps?.groups?.body).toContain('font-size: 0.75rem;');
    expect(citations?.groups?.body).toContain('font-size: 0.75rem;');
  });
});
