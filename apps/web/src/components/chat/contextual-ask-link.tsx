'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import type { ChatHandoffContext } from '@/lib/chat-handoff';

import { Button } from '@/components/ui/button';
import { storeChatContextHandoff } from '@/lib/chat-handoff';
import { cn } from '@/lib/utils';

interface Props {
  teamId: string;
  context: ChatHandoffContext;
  pinnedEntityId?: string;
  pinnedEntityName?: string;
  label?: string;
  className?: string;
}

export function ContextualAskLink({
  teamId,
  context,
  pinnedEntityId,
  pinnedEntityName,
  label = 'Ask',
  className,
}: Props) {
  const router = useRouter();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn('shrink-0', className)}
      onClick={() => {
        try {
          storeChatContextHandoff(window.sessionStorage, teamId, {
            context,
            pinnedEntityId,
            pinnedEntityName,
          });
          router.push('/app/chat');
        } catch {
          toast.error(
            'Ask could not preserve this page context. Check browser storage and try again.',
          );
        }
      }}
    >
      <MessageCircleQuestion aria-hidden="true" />
      {label}
    </Button>
  );
}
