'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ChatContextRef } from '@timeline/shared/chat-context';

import type { ChatHandoffContext } from '@/lib/chat-handoff';
import { buildChatView, type ChatViewOverlay } from '@/lib/chat-view';

interface ChatViewRegistry {
  overlay: ChatViewOverlay | null;
  register: (overlay: ChatViewOverlay) => void;
  unregister: (viewKey: string) => void;
}

const ChatViewRegistryContext = createContext<ChatViewRegistry | null>(null);

export function ChatViewProvider({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<ChatViewOverlay[]>([]);
  const register = useCallback((next: ChatViewOverlay) => {
    setOverlays((current) => [...current.filter((item) => item.viewKey !== next.viewKey), next]);
  }, []);
  const unregister = useCallback((viewKey: string) => {
    setOverlays((current) => current.filter((item) => item.viewKey !== viewKey));
  }, []);
  const value = useMemo<ChatViewRegistry>(
    () => ({
      overlay: overlays.at(-1) ?? null,
      register,
      unregister,
    }),
    [overlays, register, unregister],
  );

  return <ChatViewRegistryContext value={value}>{children}</ChatViewRegistryContext>;
}

function useChatViewRegistry(): ChatViewRegistry | null {
  return use(ChatViewRegistryContext);
}

export function useCurrentChatView(): {
  current: ChatContextRef;
  dashboardContext: ChatHandoffContext;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const registry = useChatViewRegistry();
  if (!registry) {
    throw new Error('useCurrentChatView must be used within ChatViewProvider');
  }
  const { overlay } = registry;
  return useMemo(
    () => buildChatView({ pathname, searchParams, overlay }),
    [overlay, pathname, searchParams],
  );
}

export function ChatViewContextBinder(props: ChatViewOverlay) {
  const registry = useChatViewRegistry();
  useEffect(() => {
    if (!registry) return;
    registry.register(props);
    return () => {
      registry.unregister(props.viewKey);
    };
  }, [
    props.boardId,
    props.boardItemId,
    props.calendarEventId,
    props.documentId,
    props.href,
    props.viewKey,
    props.kind,
    props.label,
    props.meetingId,
    props.objectId,
    props.taskId,
    props.timelineEventId,
    props.timelineMomentId,
    registry,
  ]);
  return null;
}
