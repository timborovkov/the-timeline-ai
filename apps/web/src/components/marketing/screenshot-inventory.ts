import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

import { AGENTS_HUB } from '@/components/marketing/agents/content';
import {
  EDITORIAL_GUIDES,
  HOW_IT_WORKS_SCREENSHOTS,
} from '@/components/marketing/editorial/content';
import { HOME_PROOF_SHOTS } from '@/components/marketing/home/proof';
import { CONNECTORS } from '@/components/marketing/integrations/connector-content';
import { MCP_GUIDE_PAGE } from '@/components/marketing/integrations/mcp-guide-content';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';
import { SOLUTIONS } from '@/components/marketing/solutions/content';
import { USE_CASES } from '@/components/marketing/use-cases/content';

const PUBLIC_ROOTS = [
  join(process.cwd(), 'public'),
  join(process.cwd(), 'apps/web/public'),
] as const;

export function marketingScreenshotFileExists(file: string): boolean {
  return PUBLIC_ROOTS.some((root) => existsSync(join(root, 'marketing/screenshots', file)));
}

export interface MarketingScreenshotReference {
  source: string;
  file: string;
  alt: string;
  caption: string;
}

function slotRef(source: string, slot: MarketingScreenshotSlot): MarketingScreenshotReference {
  return { source, file: slot.file, alt: slot.alt, caption: slot.caption };
}

export function listMarketingScreenshotReferences(): MarketingScreenshotReference[] {
  const refs: MarketingScreenshotReference[] = [];

  for (const step of PRODUCT_TOUR.steps) {
    refs.push(
      slotRef(`product-tour:${step.index}`, {
        file: step.file,
        alt: step.alt,
        caption: step.caption,
      }),
    );
    if (step.mobileFile) {
      refs.push(
        slotRef(`product-tour:${step.index}:mobile`, {
          file: step.mobileFile,
          alt: step.alt,
          caption: step.caption,
          frame: 'portrait',
        }),
      );
    }
  }

  for (const shot of HOME_PROOF_SHOTS) {
    refs.push(slotRef(`home:${shot.kicker}`, shot));
  }

  refs.push(slotRef('agents', AGENTS_HUB.screenshot));
  refs.push(slotRef('telegram', TELEGRAM_PAGE.screenshot));
  refs.push(slotRef('mcp-guide', MCP_GUIDE_PAGE.screenshot));

  for (const shot of HOW_IT_WORKS_SCREENSHOTS) {
    refs.push(slotRef(`how-it-works:${shot.file}`, shot));
  }

  for (const connector of CONNECTORS) {
    if (connector.screenshot) {
      refs.push(slotRef(`integrations/${connector.slug}`, connector.screenshot));
    }
  }

  for (const useCase of USE_CASES) {
    for (const shot of useCase.screenshots) {
      refs.push(slotRef(`${useCase.route}:${shot.placement}`, shot));
    }
  }

  for (const guide of EDITORIAL_GUIDES) {
    for (const shot of guide.screenshots ?? []) {
      refs.push(slotRef(`${guide.route}:${shot.file}`, shot));
    }
  }

  for (const solution of SOLUTIONS) {
    for (const shot of solution.screenshots ?? []) {
      refs.push(slotRef(`${solution.route}:${shot.file}`, shot));
    }
  }

  return refs;
}

export function listMissingMarketingScreenshots(
  refs: readonly MarketingScreenshotReference[] = listMarketingScreenshotReferences(),
): MarketingScreenshotReference[] {
  return refs.filter((ref) => !marketingScreenshotFileExists(ref.file));
}
