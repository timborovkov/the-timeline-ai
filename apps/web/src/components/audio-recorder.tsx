'use client';

import { useEffect, useRef, useState } from 'react';

import { createAudioEventAction, requestAudioUploadAction } from '@/app/actions/events';
import { Button } from '@/components/ui/button';

type Phase = 'idle' | 'recording' | 'review' | 'uploading' | 'done' | 'error';

interface RecordedClip {
  blob: Blob;
  url: string;
  mimeType: string;
  durationSec: number;
}

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return undefined;
}

function baseMimeType(mt: string): string {
  // "audio/webm;codecs=opus" -> "audio/webm" (the action validates the base
  // form against the audio/ prefix and to keep key extensions sane).
  return mt.split(';')[0]?.trim() ?? mt;
}

export function AudioRecorder() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [visibility, setVisibility] = useState<'team' | 'private'>('team');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  // Revoke object URL when clip changes / unmounts to avoid leaking memory.
  useEffect(() => {
    return () => {
      if (clip?.url) URL.revokeObjectURL(clip.url);
    };
  }, [clip?.url]);

  // Hard cleanup on unmount: stop the mic and any in-flight recorder so the
  // browser indicator clears even if the user navigates away mid-recording.
  // Empty deps — this only runs at unmount; per-render mic state is managed
  // by start/stop/reset.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // already stopped or browser threw — fall through to track stop
        }
      }
      streamRef.current?.getTracks().forEach((t) => {
        t.stop();
      });
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const supported = typeof MediaRecorder !== 'undefined';

  async function start(): Promise<void> {
    setError(null);
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setError('Audio recording is not supported in this browser');
      setPhase('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      try {
        const recorder = new MediaRecorder(stream, { mimeType });
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
          // Stop the mic so the browser indicator clears.
          streamRef.current?.getTracks().forEach((t) => {
            t.stop();
          });
          streamRef.current = null;
          setClip({ blob, url: URL.createObjectURL(blob), mimeType, durationSec });
          setPhase('review');
        };
        recorder.start();
        recorderRef.current = recorder;
        startedAtRef.current = Date.now();
        setPhase('recording');
      } catch (innerErr) {
        // getUserMedia already opened the mic; if MediaRecorder construction
        // or start throws (unsupported mime, hardware busy, etc.), the
        // tracks would otherwise stay live with no UI affordance to stop
        // them. Release immediately and rethrow into the outer catch.
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        streamRef.current = null;
        throw innerErr;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      setPhase('error');
    }
  }

  function stop(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function reset(): void {
    if (clip?.url) URL.revokeObjectURL(clip.url);
    setClip(null);
    setPhase('idle');
    setError(null);
  }

  async function send(): Promise<void> {
    if (!clip) return;
    setPhase('uploading');
    setError(null);
    const base = baseMimeType(clip.mimeType);
    try {
      const req = await requestAudioUploadAction(base);
      if (!req.ok || !req.url || !req.key) {
        throw new Error(req.error ?? 'Upload request failed');
      }
      const put = await fetch(req.url, {
        method: 'PUT',
        headers: { 'content-type': req.contentType ?? base },
        body: clip.blob,
      });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
      const create = await createAudioEventAction({
        key: req.key,
        mimeType: base,
        durationSec: clip.durationSec,
        visibility,
      });
      if (!create.ok) throw new Error(create.error ?? 'Save failed');
      // Soft warning means the row is committed; never re-send.
      if (create.warning) setError(create.warning);
      setPhase('done');
      // Auto-reset shortly after so the user can record another.
      setTimeout(reset, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('error');
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        Audio recording is not supported in this browser. Try Chrome, Edge, or Firefox.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">Voice note</span>
        {phase === 'idle' || phase === 'error' ? (
          <Button type="button" size="sm" onClick={() => void start()}>
            Record
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <Button type="button" size="sm" variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : null}
        {phase === 'review' ? (
          <>
            <Button type="button" size="sm" onClick={() => void send()}>
              Send
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Discard
            </Button>
          </>
        ) : null}
        {phase === 'uploading' ? (
          <span className="text-xs text-muted-foreground">Uploading…</span>
        ) : null}
        {phase === 'done' ? <span className="text-xs text-emerald-600">Sent ✓</span> : null}
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={visibility === 'private'}
            onChange={(e) => {
              setVisibility(e.target.checked ? 'private' : 'team');
            }}
            className="h-3.5 w-3.5"
          />
          Private
        </label>
      </div>
      {clip ? (
        <audio src={clip.url} controls preload="metadata" className="w-full" />
      ) : phase === 'recording' ? (
        <p className="text-xs text-muted-foreground">Recording… press Stop when finished.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
