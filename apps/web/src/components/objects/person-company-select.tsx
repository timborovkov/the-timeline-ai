'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { setPersonCompanyAction } from '@/app/actions/objects';
import { CompanyPicker } from '@/components/objects/company-picker';
import { notifyAction } from '@/lib/notify';

const EMPTY_COMPANIES: { id: string; label: string }[] = [];

interface Props {
  personId: string;
  companyId: string | null;
  currentCompanyLabel?: string | null;
  currentCompanyArchived?: boolean;
  companies?: { id: string; label: string }[];
  disabled?: boolean;
  quiet?: boolean;
}

export function PersonCompanySelect({
  personId,
  companyId,
  currentCompanyLabel = null,
  currentCompanyArchived = false,
  companies = EMPTY_COMPANIES,
  disabled = false,
  quiet = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <CompanyPicker
        value={companyId}
        selectedLabel={currentCompanyLabel ?? undefined}
        selectedArchived={currentCompanyArchived}
        companies={companies}
        disabled={disabled || pending}
        className={
          quiet
            ? 'h-8 border-0 bg-transparent px-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg'
            : undefined
        }
        onValueChange={(nextCompany) => {
          const nextCompanyId = nextCompany?.id ?? null;
          if (nextCompanyId === companyId) return;
          startTransition(async () => {
            const result = await notifyAction({
              id: `object:${personId}:company`,
              loading: 'Updating company…',
              success: 'Company updated',
              error: 'Couldn’t update company',
              run: () => setPersonCompanyAction({ id: personId, companyId: nextCompanyId }),
              undo: {
                run: () => setPersonCompanyAction({ id: personId, companyId }),
              },
            });
            if (!result.error) router.refresh();
          });
        }}
      />
    </div>
  );
}
