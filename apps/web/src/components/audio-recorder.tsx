'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

type Phase = 'idle' | 'recording' | 'review' | 'error';

export interface RecordedClip {
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

function subscribeMediaRecorderSupport(): () => void {
  return noopMediaRecorderSupportUnsubscribe;
}

function noopMediaRecorderSupportUnsubscribe(): void {
  return undefined;
}

function getMediaRecorderSupportSnapshot(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

function getServerMediaRecorderSupportSnapshot(): boolean {
  return true;
}

interface AudioRecorderProps {
  /**
   * Reports the current clip to the parent. Parent owns submission (the
   * surrounding form's Post button uploads the clip and creates the event)
   * so this component only records and previews.
   */
  onClipChange?: (clip: RecordedClip | null) => void;
  /** Hide controls while the parent is mid-submit. */
  disabled?: boolean;
}

export function AudioRecorder({ onClipChange, disabled = false }: AudioRecorderProps = {}) {
  const supported = useSyncExternalStore(
    subscribeMediaRecorderSupport,
    getMediaRecorderSupportSnapshot,
    getServerMediaRecorderSupportSnapshot,
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<RecordedClip | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (clip?.url) URL.revokeObjectURL(clip.url);
    };
  }, [clip?.url]);

  // Hard cleanup on unmount: stop the mic and any in-flight recorder so the
  // browser indicator clears even if the user navigates away mid-recording.
  //
  // Null `onstop` before stopping the recorder. MediaRecorder.stop() queues
  // the `stop` event asynchronously, so if we leave the handler attached, it
  // fires after the component has already unmounted (e.g. parent bumps a
  // `key` after a text-only Post while recording was still in progress). The
  // handler's closure still holds the parent's `onClipChange`, so it would
  // hand the partial blob to the parent — a "ghost clip" with no UI to see
  // or discard it, that the next Post would silently upload. We tear down
  // the stream tracks directly below instead of relying on `onstop`.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            // already stopped or browser threw — fall through to track stop
          }
        }
      }
      streamRef.current?.getTracks().forEach((t) => {
        t.stop();
      });
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

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
          streamRef.current?.getTracks().forEach((t) => {
            t.stop();
          });
          streamRef.current = null;
          const next: RecordedClip = {
            blob,
            url: URL.createObjectURL(blob),
            mimeType,
            durationSec,
          };
          setClip(next);
          setPhase('review');
          onClipChange?.(next);
        };
        recorder.start();
        recorderRef.current = recorder;
        startedAtRef.current = Date.now();
        setPhase('recording');
      } catch (innerErr) {
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

  function discard(): void {
    if (clip?.url) URL.revokeObjectURL(clip.url);
    setClip(null);
    setPhase('idle');
    setError(null);
    onClipChange?.(null);
  }

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        Audio recording is not supported in this browser. Try Chrome, Edge, or Firefox.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-sm border border-dashed border-border p-2 sm:p-3">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="text-xs font-medium text-muted-foreground">Voice note</span>
        {phase === 'idle' || phase === 'error' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void start()}
          >
            Record
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <Button type="button" size="sm" variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : null}
        {phase === 'review' ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={discard}>
            Discard
          </Button>
        ) : null}
        {phase === 'review' ? (
          <span className="text-xs text-muted-foreground">Ready. Press Post to send.</span>
        ) : null}
      </div>
      {clip ? (
        <audio
          src={clip.url}
          controls
          preload="metadata"
          className="w-full"
          aria-label="Recorded voice note preview"
        >
          <track kind="captions" src="data:text/vtt,WEBVTT" srcLang="en" label="Captions" />
        </audio>
      ) : phase === 'recording' ? (
        <p className="text-xs text-muted-foreground">Recording… press Stop when finished.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
