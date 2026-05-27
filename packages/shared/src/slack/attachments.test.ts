import { describe, expect, it } from 'vitest';

import {
  classifyConversationalAttachment,
  CONVERSATIONAL_ATTACHMENT_LIMITS,
} from './attachments.js';

describe('classifyConversationalAttachment', () => {
  it('routes audio and supported documents', () => {
    expect(
      classifyConversationalAttachment({ filename: 'voice.ogg', contentType: 'audio/ogg' }),
    ).toEqual({ kind: 'audio' });
    expect(
      classifyConversationalAttachment({ filename: 'voice.mp4', contentType: 'audio/mp4' }),
    ).toEqual({ kind: 'audio' });
    expect(
      classifyConversationalAttachment({ filename: 'voice.webm', contentType: 'audio/webm' }),
    ).toEqual({ kind: 'audio' });
    expect(
      classifyConversationalAttachment({
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      }),
    ).toEqual({ kind: 'document' });
    expect(
      classifyConversationalAttachment({ filename: 'photo.jpg', contentType: 'image/jpeg' }),
    ).toEqual({ kind: 'document' });
  });

  it('skips oversize, video, archive, executable, and unknown binary inputs', () => {
    expect(
      classifyConversationalAttachment({
        filename: 'big.pdf',
        contentType: 'application/pdf',
        sizeBytes: CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes + 1,
      }),
    ).toEqual({ kind: 'skip', reason: 'oversize' });
    expect(
      classifyConversationalAttachment({ filename: 'clip.mov', contentType: 'video/quicktime' }),
    ).toEqual({
      kind: 'skip',
      reason: 'unsupported_type',
    });
    expect(
      classifyConversationalAttachment({ filename: 'clip.mp4', contentType: 'video/mp4' }),
    ).toEqual({
      kind: 'skip',
      reason: 'unsupported_type',
    });
    expect(
      classifyConversationalAttachment({ filename: 'clip.webm', contentType: 'video/webm' }),
    ).toEqual({
      kind: 'skip',
      reason: 'unsupported_type',
    });
    expect(classifyConversationalAttachment({ filename: 'archive.zip' })).toEqual({
      kind: 'skip',
      reason: 'unsupported_type',
    });
    expect(classifyConversationalAttachment({ filename: 'payload.bin' })).toEqual({
      kind: 'skip',
      reason: 'unknown_binary',
    });
  });
});
