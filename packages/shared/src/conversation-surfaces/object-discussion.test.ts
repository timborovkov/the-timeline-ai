import { describe, expect, it, vi } from 'vitest';

import {
  createObjectDiscussionDeliveryAdapter,
  parseObjectDiscussionKey,
} from '#src/conversation-surfaces/object-discussion.js';

describe('object discussion delivery', () => {
  it('parses object conversation keys and ignores other surfaces', () => {
    expect(parseObjectDiscussionKey('object:11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(parseObjectDiscussionKey('telegram:dm:1')).toBeNull();
  });

  it('posts answers and failures as comments and no-ops progress', async () => {
    const postComment = vi.fn().mockResolvedValue(undefined);
    const adapter = createObjectDiscussionDeliveryAdapter({ postComment });
    await adapter.acknowledgeAgentRequest();
    await adapter.acknowledgeCapture();
    const stop = await adapter.startProgress();
    stop();
    await adapter.deliverAnswer('Here is the status.');
    await adapter.deliverFailure('I hit an error before I could answer. Please try again.');
    expect(postComment).toHaveBeenCalledTimes(2);
    expect(postComment).toHaveBeenNthCalledWith(1, 'Here is the status.');
  });
});
