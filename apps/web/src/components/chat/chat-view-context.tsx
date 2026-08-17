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

import type { ChatHandoffContext } from '@/lib/chat-handoff';
import type { ChatContextRef } from '@timeline/shared/chat-context';

import { buildChatView, type ChatViewOverlay } from '@/lib/chat-view';

interface ChatViewActions {
  register: (overlay: ChatViewOverlay) => void;
  unregister: (viewKey: string) => void;
}

const ChatViewActionsContext = createContext<ChatViewActions | null>(null);
const ChatViewOverlayContext = createContext<ChatViewOverlay | null | undefined>(undefined);

function overlayEqual(left: ChatViewOverlay, right: ChatViewOverlay): boolean {
  return (
    left.viewKey === right.viewKey &&
    left.kind === right.kind &&
    left.href === right.href &&
    left.label === right.label &&
    left.objectId === right.objectId &&
    left.documentId === right.documentId &&
    left.boardId === right.boardId &&
    left.boardItemId === right.boardItemId &&
    left.taskId === right.taskId &&
    left.calendarEventId === right.calendarEventId &&
    left.timelineEventId === right.timelineEventId &&
    left.timelineMomentId === right.timelineMomentId &&
    left.meetingId === right.meetingId
  );
}

export function ChatViewProvider({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<ChatViewOverlay[]>([]);
  const register = useCallback((next: ChatViewOverlay) => {
    setOverlays((current) => {
      const last = current.at(-1);
      if (last?.viewKey === next.viewKey && overlayEqual(last, next)) return current;
      return [...current.filter((item) => item.viewKey !== next.viewKey), next];
    });
  }, []);
  const unregister = useCallback((viewKey: string) => {
    setOverlays((current) =>
      current.some((item) => item.viewKey === viewKey)
        ? current.filter((item) => item.viewKey !== viewKey)
        : current,
    );
  }, []);
  const actions = useMemo<ChatViewActions>(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <ChatViewActionsContext value={actions}>
      <ChatViewOverlayContext value={overlays.at(-1) ?? null}>{children}</ChatViewOverlayContext>
    </ChatViewActionsContext>
  );
}

export function useCurrentChatView(): {
  current: ChatContextRef;
  dashboardContext: ChatHandoffContext;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const overlay = use(ChatViewOverlayContext);
  if (overlay === undefined) {
    throw new Error('useCurrentChatView must be used within ChatViewProvider');
  }
  return useMemo(
    () => buildChatView({ pathname, searchParams, overlay }),
    [overlay, pathname, searchParams],
  );
}

export function ChatViewContextBinder({
  viewKey,
  kind,
  href,
  label,
  objectId,
  documentId,
  boardId,
  boardItemId,
  taskId,
  calendarEventId,
  timelineEventId,
  timelineMomentId,
  meetingId,
}: ChatViewOverlay) {
  const actions = use(ChatViewActionsContext);
  useEffect(() => {
    if (!actions) return;
    actions.register({
      viewKey,
      kind,
      href,
      label,
      ...(objectId ? { objectId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(boardId ? { boardId } : {}),
      ...(boardItemId ? { boardItemId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(calendarEventId ? { calendarEventId } : {}),
      ...(timelineEventId ? { timelineEventId } : {}),
      ...(timelineMomentId ? { timelineMomentId } : {}),
      ...(meetingId ? { meetingId } : {}),
    });
    return () => {
      actions.unregister(viewKey);
    };
  }, [
    actions,
    boardId,
    boardItemId,
    calendarEventId,
    documentId,
    href,
    kind,
    label,
    meetingId,
    objectId,
    taskId,
    timelineEventId,
    timelineMomentId,
    viewKey,
  ]);
  return null;
}
