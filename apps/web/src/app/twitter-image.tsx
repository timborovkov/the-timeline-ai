// Twitter uses the same composition as the OG card. Next 15 doesn't
// auto-promote opengraph-image to twitter-image — re-export the default
// generator so the rendered HTML carries both `og:image` and
// `twitter:image`. Metadata config (alt/size/contentType) MUST
// be declared inline; Next's metadata analyzer can't follow re-exports.
export { default } from '@/app/opengraph-image';

export const alt = 'The Timeline — the operations log your team can talk to';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
