import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Check,
  Clipboard,
  Copy,
  Download,
  FileUp,
  FolderSync,
  Keyboard,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorUp,
  MousePointer,
  PhoneOff,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatBytes, formatDeskId, formatDuration, formatSpeed } from '../lib/platform';
import type {
  ActiveSession,
  ClipboardItem,
  FileTransferItem,
  MonitorInfo,
  QualityPreset,
  RemotePointerState,
  SessionChatMessage,
  WebRTCStatsSnapshot,
} from '../types';
import { PlatformIcon } from './PlatformIcon';

interface LocalMonitorEntry {
  info: MonitorInfo;
  stream: MediaStream;
}

interface ActiveSessionWorkspaceProps {
  session: ActiveSession;
  localFingerprint: string;
  canHostScreen: boolean;
  localMonitors: LocalMonitorEntry[];
  remoteMonitors: MonitorInfo[];
  remoteStreams: Record<string, MediaStream>;
  activeMonitorId: string;
  qualityPreset: QualityPreset;
  rtcStats: WebRTCStatsSnapshot;
  clipboardHistory: ClipboardItem[];
  autoClipboardSync: boolean;
  fileTransfers: FileTransferItem[];
  chatMessages: SessionChatMessage[];
  remotePointer: RemotePointerState;
  onEndSession: () => void;
  onAddHostMonitor: () => Promise<boolean>;
  onRemoveHostMonitor: (id: string) => Promise<void>;
  onSelectMonitor: (id: string) => void;
  onSetQualityPreset: (preset: QualityPreset) => Promise<void>;
  onSendPointer: (
    x: number,
    y: number,
    event: 'move' | 'down' | 'up' | 'wheel',
    button?: number,
    deltaY?: number
  ) => void;
  onSendKey: (payload: {
    key: string;
    code: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => void;
  onSyncClipboard: (text?: string) => Promise<boolean>;
  onToggleAutoClipboard: (val: boolean) => void;
  onSendFiles: (files: FileList | File[]) => Promise<void>;
  onSendChat: (text: string) => Promise<void>;
}

function VideoStreamPlayer({
  stream,
  muted,
  fitMode,
  label,
  resolution,
  interactive,
  remotePointer,
  onPointer,
  onKey,
}: {
  stream: MediaStream;
  muted: boolean;
  fitMode: 'contain' | 'cover';
  label: string;
  resolution?: string;
  interactive: boolean;
  remotePointer?: RemotePointerState;
  onPointer?: (
    x: number,
    y: number,
    event: 'move' | 'down' | 'up' | 'wheel',
    button?: number,
    deltaY?: number
  ) => void;
  onKey?: (payload: {
    key: string;
    code: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastMoveRef = useRef<number>(0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
  }, [stream]);

  const computeNormCoords = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!interactive || !onPointer) return;
    const now = performance.now();
    if (now - lastMoveRef.current < 28) return;
    lastMoveRef.current = now;
    const { x, y } = computeNormCoords(e.clientX, e.clientY);
    onPointer(x, y, 'move');
  };

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    containerRef.current?.focus();
    if (!interactive || !onPointer) return;
    const { x, y } = computeNormCoords(e.clientX, e.clientY);
    onPointer(x, y, 'down', e.button);
  };

  const handleMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!interactive || !onPointer) return;
    const { x, y } = computeNormCoords(e.clientX, e.clientY);
    onPointer(x, y, 'up', e.button);
  };

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!interactive || !onPointer) return;
    const { x, y } = computeNormCoords(e.clientX, e.clientY);
    onPointer(x, y, 'wheel', undefined, e.deltaY);
  };

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!interactive || !onPointer || e.touches.length === 0) return;
    const t = e.touches[0];
    const { x, y } = computeNormCoords(t.clientX, t.clientY);
    onPointer(x, y, 'down', 0);
  };

  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!interactive || !onPointer || e.touches.length === 0) return;
    const now = performance.now();
    if (now - lastMoveRef.current < 32) return;
    lastMoveRef.current = now;
    const t = e.touches[0];
    const { x, y } = computeNormCoords(t.clientX, t.clientY);
    onPointer(x, y, 'move');
  };

  const handleTouchEnd = () => {
    if (!interactive || !onPointer) return;
    onPointer(0.5, 0.5, 'up', 0);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!interactive || !onKey) return;
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    onKey({
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });
  };

  return (
    <div
      ref={containerRef}
      tabIndex={interactive ? 0 : -1}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      className={`relative w-full h-full min-h-[260px] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 select-none outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
        interactive ? 'cursor-crosshair' : ''
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full ${fitMode === 'contain' ? 'object-contain' : 'object-cover'}`}
      />

      {/* Display label overlay */}
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-950/75 border border-white/10 text-xs text-slate-200">
        <Monitor className="w-3.5 h-3.5 text-slate-400" />
        <span className="font-medium">{label}</span>
        {resolution && (
          <>
            <span aria-hidden="true" className="text-slate-500">
              ·
            </span>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">{resolution}</span>
          </>
        )}
      </div>

      {/* Host Remote Operator Pointer HUD */}
      {remotePointer && remotePointer.visible && (
        <div
          className="pointer-events-none absolute z-20 transition-transform duration-75"
          style={{
            left: `${remotePointer.x * 100}%`,
            top: `${remotePointer.y * 100}%`,
            transform: 'translate(-2px, -2px)',
          }}
        >
          <div
            className={`w-4 h-4 rounded-full border-2 border-white shadow-md ${
              remotePointer.clicking ? 'bg-red-600 scale-125' : 'bg-red-500/80'
            }`}
          />
          <div className="mt-1 px-2 py-0.5 rounded bg-slate-950/85 text-[11px] font-medium text-white whitespace-nowrap border border-white/15">
            {remotePointer.senderAlias}
            {remotePointer.lastKey ? ` · ${remotePointer.lastKey}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export function ActiveSessionWorkspace({
  session,
  localFingerprint,
  canHostScreen,
  localMonitors,
  remoteMonitors,
  remoteStreams,
  activeMonitorId,
  qualityPreset,
  rtcStats,
  clipboardHistory,
  autoClipboardSync,
  fileTransfers,
  chatMessages,
  remotePointer,
  onEndSession,
  onAddHostMonitor,
  onRemoveHostMonitor,
  onSelectMonitor,
  onSetQualityPreset,
  onSendPointer,
  onSendKey,
  onSyncClipboard,
  onToggleAutoClipboard,
  onSendFiles,
  onSendChat,
}: ActiveSessionWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileKeyInputRef = useRef<HTMLInputElement | null>(null);

  const [drawerTab, setDrawerTab] = useState<'files' | 'clipboard' | 'details' | null>('files');
  const [muted, setMuted] = useState(false);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSecurityPopover, setShowSecurityPopover] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clipboardDraft, setClipboardDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [mobileKeyValue, setMobileKeyValue] = useState('');

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - session.startedAt);
    }, 1000);
    return () => window.clearInterval(id);
  }, [session.startedAt]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await rootRef.current?.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  // Build list of display feeds to render
  const displayFeeds = useMemo(() => {
    if (session.role === 'host') {
      return localMonitors.map((m) => ({
        id: m.info.id,
        label: m.info.label,
        resolution: `${m.info.width}×${m.info.height}`,
        stream: m.stream,
      }));
    }

    const entries: { id: string; label: string; resolution: string; stream: MediaStream }[] = [];
    for (const mon of remoteMonitors) {
      const stream =
        (mon.streamId ? remoteStreams[mon.streamId] : undefined) || remoteStreams[mon.trackId];
      if (stream && !entries.some((e) => e.stream === stream)) {
        entries.push({
          id: mon.id,
          label: mon.label,
          resolution: `${mon.width}×${mon.height}`,
          stream,
        });
      }
    }
    // Include any streams that didn't match a MonitorInfo yet
    for (const [key, stream] of Object.entries(remoteStreams)) {
      if (key.startsWith('audio_')) continue;
      if (!entries.some((e) => e.stream === stream)) {
        entries.push({
          id: key,
          label: `Display ${entries.length + 1}`,
          resolution: '',
          stream,
        });
      }
    }
    return entries;
  }, [localMonitors, remoteMonitors, remoteStreams, session.role]);

  const visibleFeeds = useMemo(() => {
    if (displayFeeds.length <= 1 || activeMonitorId === 'all') return displayFeeds;
    const match = displayFeeds.filter((f) => f.id === activeMonitorId);
    return match.length > 0 ? match : displayFeeds;
  }, [activeMonitorId, displayFeeds]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (session.permissions.fileTransfer) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFiles(false);
    if (!session.permissions.fileTransfer) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDrawerTab('files');
      await onSendFiles(e.dataTransfer.files);
    }
  };

  const handleCopyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  const activeTransfersCount = fileTransfers.filter(
    (f) => f.status === 'transferring' || f.status === 'pending' || f.status === 'verifying'
  ).length;

  return (
    <div
      ref={rootRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex flex-col h-[calc(100vh-57px)] bg-slate-100 dark:bg-slate-950 overflow-hidden"
    >
      {/* Session Top Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
        {/* Left: Peer Identity & E2E SAS */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <PlatformIcon
              platform={session.remotePlatform}
              className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0"
            />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
              {session.remoteAlias}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums hidden sm:inline">
              {formatDeskId(session.remoteDeskId)}
            </span>
          </div>

          <span className="text-slate-300 dark:text-slate-700 hidden md:inline" aria-hidden="true">
            ·
          </span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSecurityPopover((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>E2E Verified</span>
              <span className="font-mono text-[11px] opacity-80 hidden lg:inline">
                · {session.sasCode}
              </span>
            </button>

            {showSecurityPopover && (
              <div className="absolute left-0 top-full mt-2 z-40 w-80 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    End-to-End Authentication
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSecurityPopover(false)}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/60">
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                    Shared SAS Verification Phrase
                  </div>
                  <div className="font-mono text-sm font-semibold text-emerald-900 dark:text-emerald-200 mt-0.5">
                    {session.sasCode} · {session.sasPhrase}
                  </div>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Your ECDH Fingerprint</div>
                    <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 tabular-nums">
                      {localFingerprint}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Remote ECDH Fingerprint</div>
                    <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 tabular-nums">
                      {session.remoteFingerprint}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Control input, clipboard sync, and file chunks are encrypted end-to-end with
                  AES-256-GCM over WebRTC DTLS-SRTP.
                </p>
              </div>
            )}
          </div>

          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums hidden xl:inline">
            {formatDuration(elapsedMs)}
          </span>
        </div>

        {/* Center: Multi-Monitor Switcher & Quality Presets */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Monitor Switcher */}
          {displayFeeds.length > 0 && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {displayFeeds.length > 1 && (
                <button
                  type="button"
                  onClick={() => onSelectMonitor('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeMonitorId === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  All ({displayFeeds.length})
                </button>
              )}
              {displayFeeds.map((feed, idx) => (
                <button
                  key={feed.id}
                  type="button"
                  onClick={() => onSelectMonitor(feed.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeMonitorId === feed.id || (displayFeeds.length === 1 && idx === 0)
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Display {idx + 1}
                </button>
              ))}
            </div>
          )}

          {session.role === 'host' && canHostScreen && (
            <button
              type="button"
              onClick={onAddHostMonitor}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <MonitorUp className="w-3.5 h-3.5" />
              <span>{localMonitors.length === 0 ? 'Share Screen' : 'Add Monitor'}</span>
            </button>
          )}

          {/* Quality Presets */}
          <div className="hidden lg:flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            {(
              [
                { id: 'low-latency', label: '60fps Low Latency' },
                { id: 'balanced', label: 'Balanced' },
                { id: 'data-saver', label: 'Data Saver' },
              ] as const
            ).map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onSetQualityPreset(q.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  qualityPreset === q.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Controls, Drawers, Disconnect */}
        <div className="flex items-center gap-1.5 shrink-0">
          {session.role === 'viewer' && (
            <>
              <button
                type="button"
                onClick={() => setInputEnabled((v) => !v)}
                disabled={!session.permissions.remoteInput}
                title={inputEnabled ? 'Remote Input Active' : 'View Only'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  inputEnabled && session.permissions.remoteInput
                    ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                    : 'border-slate-200 dark:border-slate-800 text-slate-400'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {inputEnabled ? 'Input On' : 'View Only'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'))}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 hidden md:inline-flex"
              >
                {fitMode === 'contain' ? 'Fit Screen' : 'Fill Frame'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setDrawerTab((t) => (t === 'files' ? null : 'files'))}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              drawerTab === 'files'
                ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <FolderSync className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Files</span>
            {activeTransfersCount > 0 && (
              <span className="font-mono tabular-nums text-[11px]">({activeTransfersCount})</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setDrawerTab((t) => (t === 'clipboard' ? null : 'clipboard'))}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              drawerTab === 'clipboard'
                ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clipboard</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerTab((t) => (t === 'details' ? null : 'details'))}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              drawerTab === 'details'
                ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
            aria-label="Stream stats and chat"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors hidden sm:inline-flex"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onEndSession}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
        </div>
      </div>

      {/* Main Split: Remote Viewport + Optional Right Drawer */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Viewport Column */}
        <div className="flex-1 flex flex-col min-w-0 p-3 sm:p-4 gap-3 overflow-hidden">
          {visibleFeeds.length > 0 ? (
            <div
              className={`flex-1 min-h-0 grid gap-3 ${
                visibleFeeds.length > 1 && activeMonitorId === 'all'
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1'
              }`}
            >
              {visibleFeeds.map((feed) => (
                <div key={feed.id} className="relative h-full min-h-0 flex flex-col">
                  <VideoStreamPlayer
                    stream={feed.stream}
                    muted={session.role === 'host' ? true : muted}
                    fitMode={fitMode}
                    label={feed.label}
                    resolution={feed.resolution}
                    interactive={session.role === 'viewer' && inputEnabled && session.permissions.remoteInput}
                    remotePointer={session.role === 'host' ? remotePointer : undefined}
                    onPointer={onSendPointer}
                    onKey={onSendKey}
                  />
                  {session.role === 'host' && (
                    <button
                      type="button"
                      onClick={() => onRemoveHostMonitor(feed.id)}
                      className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-slate-950/80 hover:bg-red-600 text-xs font-medium text-white border border-white/15 transition-colors"
                    >
                      Stop Share
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Connected E2E Collaboration State when screen video is not yet streaming */
            <div className="flex-1 flex items-center justify-center rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8">
              <div className="max-w-md text-center space-y-4">
                <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200">
                  <Monitor className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {session.role === 'host'
                      ? 'Encrypted Session Active — Ready to Share Screen'
                      : `Connected to ${session.remoteAlias}`}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {session.role === 'host'
                      ? canHostScreen
                        ? 'Choose one or more monitors to stream in 60fps low latency, or use drag-and-drop file transfer and clipboard sync immediately.'
                        : 'Screen capture is unavailable on this mobile browser. File transfer, clipboard sync, and chat remain active.'
                      : 'Waiting for the remote host to select a display or window. You can drag and drop files here or sync clipboards now.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  {session.role === 'host' && canHostScreen && (
                    <button
                      type="button"
                      onClick={onAddHostMonitor}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                      <MonitorUp className="w-4 h-4" />
                      <span>Share Display</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <FileUp className="w-4 h-4" />
                    <span>Send Files</span>
                  </button>
                </div>

                {session.role === 'host' && remotePointer.visible && (
                  <div className="pt-3 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Remote input received from {remotePointer.senderAlias}: ({Math.round(remotePointer.x * 100)}%,{' '}
                    {Math.round(remotePointer.y * 100)}%)
                    {remotePointer.lastKey ? ` · Key: ${remotePointer.lastKey}` : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom Viewer Quick-Keys & Mobile Touch Keyboard Bar */}
          {session.role === 'viewer' && session.permissions.remoteInput && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-slate-400 mr-1 hidden sm:inline">
                  Quick Keys
                </span>
                {[
                  { label: 'Esc', key: 'Escape', code: 'Escape' },
                  { label: 'Tab', key: 'Tab', code: 'Tab' },
                  { label: 'Ctrl+Alt+Del', key: 'Delete', code: 'Delete', ctrl: true, alt: true },
                  { label: 'Cmd+Space', key: ' ', code: 'Space', meta: true },
                  { label: 'Copy', key: 'c', code: 'KeyC', ctrl: true },
                  { label: 'Paste', key: 'v', code: 'KeyV', ctrl: true },
                ].map((shortcut) => (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => onSendKey(shortcut)}
                    className="px-2.5 py-1 text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>

              {/* Mobile / Touch Virtual Keyboard Bridge */}
              <div className="flex items-center gap-2">
                <div className="relative flex items-center">
                  <Keyboard className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    ref={mobileKeyInputRef}
                    type="text"
                    value={mobileKeyValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        const lastChar = val.slice(-1);
                        onSendKey({ key: lastChar, code: `Key${lastChar.toUpperCase()}` });
                      }
                      setMobileKeyValue('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' || e.key === 'Enter') {
                        onSendKey({ key: e.key, code: e.code });
                      }
                    }}
                    placeholder="Type to remote..."
                    className="pl-8 pr-3 py-1 w-36 sm:w-44 text-xs rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Collaboration Drawer */}
        {drawerTab && (
          <aside className="w-80 sm:w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0">
            {/* Drawer Tab Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                {(
                  [
                    { id: 'files', label: 'Files' },
                    { id: 'clipboard', label: 'Clipboard' },
                    { id: 'details', label: 'Stats & Chat' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDrawerTab(t.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      drawerTab === t.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDrawerTab(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Close drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* FILES TAB */}
            {drawerTab === 'files' && (
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-4 overflow-y-auto">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      onSendFiles(e.target.files);
                      e.target.value = '';
                    }
                  }}
                />

                <button
                  type="button"
                  disabled={!session.permissions.fileTransfer}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-red-500 dark:hover:border-red-500 bg-slate-50 dark:bg-slate-950/60 text-center space-y-1.5 transition-colors disabled:opacity-50"
                >
                  <FileUp className="w-5 h-5 mx-auto text-slate-500 dark:text-slate-400" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Drop files anywhere or click to send
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Encrypted AES-256-GCM · SHA-256 verified
                  </div>
                </button>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Transfer Queue ({fileTransfers.length})
                  </div>

                  {fileTransfers.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                      No files transferred in this session yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      {fileTransfers.map((file) => {
                        const pct =
                          file.size > 0
                            ? Math.min(100, Math.round((file.transferredBytes / file.size) * 100))
                            : 100;
                        return (
                          <div key={file.id} className="p-3 space-y-2 bg-white dark:bg-slate-900">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {file.name}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                  {file.direction === 'upload' ? 'Sent' : 'Received'} ·{' '}
                                  {formatBytes(file.size)}
                                  {file.status === 'transferring' && file.speedBps > 0
                                    ? ` · ${formatSpeed(file.speedBps)}`
                                    : ''}
                                </div>
                              </div>
                              {file.downloadUrl && file.status === 'completed' && (
                                <a
                                  href={file.downloadUrl}
                                  download={file.name}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium shrink-0"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Save</span>
                                </a>
                              )}
                            </div>

                            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  file.status === 'failed'
                                    ? 'bg-red-600'
                                    : file.status === 'completed'
                                    ? 'bg-emerald-600'
                                    : 'bg-red-600'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                              <span>
                                {file.status === 'completed'
                                  ? file.verified
                                    ? 'SHA-256 Verified'
                                    : 'Completed'
                                  : file.status === 'verifying'
                                  ? 'Verifying hash...'
                                  : file.status === 'failed'
                                  ? file.error || 'Failed'
                                  : `${pct}%`}
                              </span>
                              {file.sha256 && (
                                <span className="font-mono">{file.sha256.slice(0, 10)}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CLIPBOARD TAB */}
            {drawerTab === 'clipboard' && (
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-4 overflow-y-auto">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoClipboardSync}
                      onChange={(e) => onToggleAutoClipboard(e.target.checked)}
                      className="rounded border-slate-300 text-red-600 focus:ring-red-600"
                    />
                    <span>Auto-write incoming clipboard</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onSyncClipboard()}
                    disabled={!session.permissions.clipboardSync}
                    className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    Push Clipboard
                  </button>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!clipboardDraft.trim()) return;
                    await onSyncClipboard(clipboardDraft);
                    setClipboardDraft('');
                  }}
                  className="space-y-2"
                >
                  <textarea
                    rows={3}
                    value={clipboardDraft}
                    onChange={(e) => setClipboardDraft(e.target.value)}
                    placeholder="Paste or type text to sync directly to remote clipboard..."
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-red-600 resize-none"
                  />
                  <button
                    type="submit"
                    disabled={!clipboardDraft.trim() || !session.permissions.clipboardSync}
                    className="w-full py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors disabled:opacity-50"
                  >
                    Send to Remote Clipboard
                  </button>
                </form>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Synced History ({clipboardHistory.length})
                  </div>
                  {clipboardHistory.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                      No clipboard entries synced yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {clipboardHistory.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                            <span>
                              {item.source === 'local' ? 'Sent' : 'From'} · {item.senderAlias}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(item.id, item.text)}
                              className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-red-600 font-medium"
                            >
                              {copiedId === item.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                            {item.text}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STATS & CHAT TAB */}
            {drawerTab === 'details' && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Live Stream Telemetry
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Lock className="w-3 h-3" />
                      {rtcStats.transportMode === 'webrtc-p2p' ? 'WebRTC P2P' : 'E2E Relay'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs pt-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">RTT Latency</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {rtcStats.rttMs !== null ? `${rtcStats.rttMs} ms` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Framerate</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {rtcStats.fps !== null ? `${rtcStats.fps} fps` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Bitrate</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {rtcStats.bitrateKbps !== null ? `${rtcStats.bitrateKbps} kbps` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Resolution</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {rtcStats.width && rtcStats.height
                          ? `${rtcStats.width}×${rtcStats.height}`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Codec</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {rtcStats.codec || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">ICE Path</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {rtcStats.candidateType || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Session Chat */}
                <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Encrypted Session Chat
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {chatMessages.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                        Messages sent here are encrypted with AES-256-GCM.
                      </p>
                    ) : (
                      chatMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`flex flex-col ${
                            m.sender === 'local' ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-lg text-xs ${
                              m.sender === 'local'
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {m.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!chatDraft.trim()) return;
                      await onSendChat(chatDraft);
                      setChatDraft('');
                    }}
                    className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800"
                  >
                    <input
                      type="text"
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value)}
                      placeholder="Message peer..."
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                    <button
                      type="submit"
                      disabled={!chatDraft.trim()}
                      className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 transition-colors"
                      aria-label="Send message"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Drag-and-drop File Dropzone Overlay */}
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs">
          <div className="px-8 py-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-dashed border-red-600 text-center space-y-2 shadow-2xl">
            <FileUp className="w-8 h-8 mx-auto text-red-600" />
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Drop files to transfer to {session.remoteAlias}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              AES-256-GCM Encrypted · SHA-256 Integrity Checked
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
