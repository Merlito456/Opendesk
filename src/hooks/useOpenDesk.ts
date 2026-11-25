import { useCallback, useEffect, useRef, useState } from 'react';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decryptPayload,
  deriveSessionSecurity,
  encryptPayload,
  hashPasscode,
  loadOrCreateIdentityKeys,
  regenerateIdentityKeys,
  sha256Buffer,
  type IdentityKeys,
} from '../lib/crypto';
import { FreeCloudRelayClient } from '../lib/mqttSignal';
import {
  defaultDeviceAlias,
  detectPlatform,
  generateDeskId,
  normalizeDeskId,
  supportsDisplayCapture,
} from '../lib/platform';
import type {
  ActiveSession,
  ClipboardItem,
  FileTransferItem,
  IncomingSessionRequest,
  MonitorInfo,
  PeerDirectoryEntry,
  PlatformOS,
  QualityPreset,
  RelayFrameState,
  RemotePointerState,
  SavedDesk,
  SessionChatMessage,
  SessionPermissions,
  TurnServerConfig,
  WebRTCStatsSnapshot,
} from '../types';

const STORAGE_DESK_ID = 'opendesk_desk_id_v1';
const STORAGE_ALIAS = 'opendesk_alias_v1';
const STORAGE_SAVED_DESKS = 'opendesk_saved_desks_v1';
const STORAGE_DISCOVERABLE = 'opendesk_discoverable_v1';
const STORAGE_UNATTENDED_ENABLED = 'opendesk_unattended_enabled_v1';
const STORAGE_UNATTENDED_HASH = 'opendesk_unattended_hash_v1';
const STORAGE_PERMISSIONS = 'opendesk_default_permissions_v1';
const STORAGE_SIGNALING_URL = 'opendesk_signaling_url_v1';
const STORAGE_RELAY_MODE = 'opendesk_relay_mode_v1';
const STORAGE_RELAY_ROOM = 'opendesk_relay_room_v1';
const STORAGE_TURN_CONFIG = 'opendesk_turn_config_v1';

export type RelayModeSetting = 'auto' | 'free-cloud' | 'custom-ws';

function getConfiguredEnvSignalingUrl(): string {
  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SIGNALING_URL;
  return envUrl && envUrl.trim() ? envUrl.trim() : '';
}

function getDefaultSignalingUrl(): string {
  const envUrl = getConfiguredEnvSignalingUrl();
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const CHUNK_SIZE = 16384;

const BASE_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
];

function buildRtcConfig(turn?: TurnServerConfig | null): RTCConfiguration {
  const iceServers: RTCIceServer[] = [...BASE_STUN_SERVERS];
  if (turn && turn.urls.trim()) {
    const entry: RTCIceServer = { urls: turn.urls.trim() };
    if (turn.username?.trim()) entry.username = turn.username.trim();
    if (turn.credential?.trim()) entry.credential = turn.credential.trim();
    iceServers.push(entry);
  }
  return {
    iceServers,
    iceCandidatePoolSize: 4,
  };
}

interface LocalMonitorTrack {
  info: MonitorInfo;
  stream: MediaStream;
  videoSender?: RTCRtpSender;
  audioSender?: RTCRtpSender;
}

interface IncomingFileAccumulator {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  totalChunks: number;
  receivedChunks: (ArrayBuffer | undefined)[];
  receivedCount: number;
  receivedBytes: number;
  startedAt: number;
  lastRateCheckAt: number;
  lastRateBytes: number;
}

type ControlPacket =
  | { kind: 'monitors:update'; monitors: MonitorInfo[] }
  | { kind: 'monitor:select'; monitorId: string }
  | { kind: 'quality:set'; preset: QualityPreset }
  | { kind: 'clipboard:sync'; text: string; senderAlias: string; timestamp: number }
  | { kind: 'chat:message'; id: string; text: string; senderAlias: string; timestamp: number }
  | { kind: 'input:pointer'; x: number; y: number; event: 'move' | 'down' | 'up' | 'wheel'; button?: number; deltaY?: number; senderAlias: string }
  | { kind: 'input:key'; key: string; code: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { kind: 'file:meta'; id: string; name: string; size: number; mimeType: string; sha256: string; totalChunks: number }
  | { kind: 'file:chunk'; id: string; index: number; dataB64: string }
  | { kind: 'screen:frame'; monitorId: string; label: string; width: number; height: number; dataUrl: string; timestamp: number }
  | { kind: 'relay:stream-mode'; enabled: boolean };

const DEFAULT_PERMISSIONS: SessionPermissions = {
  viewScreen: true,
  remoteInput: true,
  fileTransfer: true,
  clipboardSync: true,
  audio: true,
};

export function useOpenDesk() {
  const platform: PlatformOS = detectPlatform();
  const canHostScreen = supportsDisplayCapture();

  const [deskId, setDeskId] = useState<string>('');
  const [isSecondaryTab, setIsSecondaryTab] = useState(false);
  const [alias, setAliasState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_ALIAS) || defaultDeviceAlias(detectPlatform());
  });
  const [fingerprint, setFingerprint] = useState<string>('');
  const [signalingUrl, setSignalingUrl] = useState<string>(() => {
    return localStorage.getItem(STORAGE_SIGNALING_URL) || getDefaultSignalingUrl();
  });
  const [relayModeSetting, setRelayModeSetting] = useState<RelayModeSetting>(() => {
    if (typeof window !== 'undefined') {
      const qRelay = new URLSearchParams(window.location.search).get('relay');
      if (qRelay === 'free-cloud' || qRelay === 'auto' || qRelay === 'custom-ws') {
        localStorage.setItem(STORAGE_RELAY_MODE, qRelay);
        return qRelay;
      }
    }
    const saved = localStorage.getItem(STORAGE_RELAY_MODE);
    if (saved === 'auto' || saved === 'free-cloud' || saved === 'custom-ws') return saved;
    return getConfiguredEnvSignalingUrl() ? 'auto' : 'free-cloud';
  });
  const [relayRoom, setRelayRoom] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const qRoom = new URLSearchParams(window.location.search).get('room');
      const cleanRoom = qRoom?.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (cleanRoom) {
        localStorage.setItem(STORAGE_RELAY_ROOM, cleanRoom);
        return cleanRoom;
      }
    }
    return localStorage.getItem(STORAGE_RELAY_ROOM) || 'opendesk-public-v1';
  });
  const [turnConfig, setTurnConfigState] = useState<TurnServerConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_TURN_CONFIG);
      if (raw) return JSON.parse(raw) as TurnServerConfig;
    } catch {
      // ignore
    }
    return { urls: '', username: '', credential: '' };
  });
  const [activeBrokerUrl, setActiveBrokerUrl] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [wsMode, setWsMode] = useState<'websocket' | 'free-cloud' | 'broadcast-local'>('free-cloud');
  const [discoverable, setDiscoverableState] = useState<boolean>(() => {
    const val = localStorage.getItem(STORAGE_DISCOVERABLE);
    return val === null ? true : val === 'true';
  });
  const [unattendedEnabled, setUnattendedEnabledState] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_UNATTENDED_ENABLED) === 'true';
  });
  const [unattendedHash, setUnattendedHashState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_UNATTENDED_HASH) || '';
  });
  const [defaultPermissions, setDefaultPermissionsState] = useState<SessionPermissions>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PERMISSIONS);
      return saved ? { ...DEFAULT_PERMISSIONS, ...JSON.parse(saved) } : DEFAULT_PERMISSIONS;
    } catch {
      return DEFAULT_PERMISSIONS;
    }
  });

  const [onlinePeers, setOnlinePeers] = useState<PeerDirectoryEntry[]>([]);
  const [savedDesks, setSavedDesks] = useState<SavedDesk[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SAVED_DESKS);
      return raw ? (JSON.parse(raw) as SavedDesk[]) : [];
    } catch {
      return [];
    }
  });

  const [pendingOutgoing, setPendingOutgoing] = useState<{
    sessionId: string;
    targetDeskId: string;
    targetAlias?: string;
    targetPlatform?: PlatformOS;
  } | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<IncomingSessionRequest | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Multi-monitor streams + E2E encrypted cloud video fallback
  const [localMonitors, setLocalMonitors] = useState<LocalMonitorTrack[]>([]);
  const [remoteMonitors, setRemoteMonitors] = useState<MonitorInfo[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteRelayFrames, setRemoteRelayFrames] = useState<Record<string, RelayFrameState>>({});
  const [activeMonitorId, setActiveMonitorId] = useState<string>('all');
  const [manualCloudStream, setManualCloudStream] = useState<boolean>(false);
  const [iceState, setIceState] = useState<RTCIceConnectionState>('new');

  // Streaming quality & live WebRTC stats
  const [qualityPreset, setQualityPresetState] = useState<QualityPreset>('low-latency');
  const [rtcStats, setRtcStats] = useState<WebRTCStatsSnapshot>({
    rttMs: null,
    fps: null,
    bitrateKbps: null,
    width: null,
    height: null,
    codec: null,
    candidateType: null,
    transportMode: 'e2e-relay',
    iceState: 'new',
  });

  // Collaboration features
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([]);
  const [autoClipboardSync, setAutoClipboardSync] = useState<boolean>(true);
  const [fileTransfers, setFileTransfers] = useState<FileTransferItem[]>([]);
  const [chatMessages, setChatMessages] = useState<SessionChatMessage[]>([]);
  const [remotePointer, setRemotePointer] = useState<RemotePointerState>({
    x: 0.5,
    y: 0.5,
    visible: false,
    clicking: false,
    senderAlias: '',
    updatedAt: 0,
  });

  // Mutable refs for WebSocket / WebRTC closures
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const aesKeyRef = useRef<CryptoKey | null>(null);
  const identityRef = useRef<IdentityKeys | null>(null);
  const activeSessionRef = useRef<ActiveSession | null>(null);
  const localMonitorsRef = useRef<LocalMonitorTrack[]>([]);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const fileAccumulatorsRef = useRef<Map<string, IncomingFileAccumulator>>(new Map());
  const prevStatsRef = useRef<{ bytes: number; ts: number } | null>(null);
  const deskIdRef = useRef<string>('');
  const aliasRef = useRef<string>(alias);
  const discoverableRef = useRef<boolean>(discoverable);
  const unattendedEnabledRef = useRef<boolean>(unattendedEnabled);
  const unattendedHashRef = useRef<string>(unattendedHash);
  const defaultPermissionsRef = useRef<SessionPermissions>(defaultPermissions);
  const autoClipboardRef = useRef<boolean>(autoClipboardSync);
  const pointerTimeoutRef = useRef<number | null>(null);
  const remoteTrackCounterRef = useRef<number>(0);
  const localSignalBcRef = useRef<BroadcastChannel | null>(null);
  const localPeersMapRef = useRef<Map<string, PeerDirectoryEntry>>(new Map());
  const signalingUrlRef = useRef<string>(signalingUrl);
  const pendingRtcSignalsRef = useRef<Map<string, Record<string, unknown>[]>>(new Map());
  const directOfferPcRef = useRef<RTCPeerConnection | null>(null);
  const mqttClientRef = useRef<FreeCloudRelayClient | null>(null);
  const relayModeRef = useRef<RelayModeSetting>(relayModeSetting);
  const relayRoomRef = useRef<string>(relayRoom);
  const turnConfigRef = useRef<TurnServerConfig>(turnConfig);
  const manualCloudStreamRef = useRef<boolean>(manualCloudStream);
  const activeMonitorIdRef = useRef<string>(activeMonitorId);
  const relayFpsCounterRef = useRef<{ count: number; windowStart: number; fps: number }>({
    count: 0,
    windowStart: Date.now(),
    fps: 0,
  });

  activeSessionRef.current = activeSession;
  localMonitorsRef.current = localMonitors;
  aliasRef.current = alias;
  discoverableRef.current = discoverable;
  unattendedEnabledRef.current = unattendedEnabled;
  unattendedHashRef.current = unattendedHash;
  defaultPermissionsRef.current = defaultPermissions;
  autoClipboardRef.current = autoClipboardSync;
  signalingUrlRef.current = signalingUrl;
  relayModeRef.current = relayModeSetting;
  relayRoomRef.current = relayRoom;
  turnConfigRef.current = turnConfig;
  manualCloudStreamRef.current = manualCloudStream;
  activeMonitorIdRef.current = activeMonitorId;

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return;
    }
    if (mqttClientRef.current && mqttClientRef.current.sendOutbound(payload)) {
      return;
    }
    // Static fallback when no WebSocket or Free Cloud relay is connected
    if (localSignalBcRef.current && deskIdRef.current) {
      localSignalBcRef.current.postMessage({
        ...payload,
        _senderDeskId: deskIdRef.current,
        _senderAlias: aliasRef.current,
        _senderPlatform: platform,
        _senderPublicKeyJwk: identityRef.current?.publicKeyJwk,
        _senderFingerprint: identityRef.current?.fingerprint,
      });
    }
  }, [platform]);

  const syncRegistrationToServer = useCallback(() => {
    const id = deskIdRef.current;
    const identity = identityRef.current;
    if (!id || !identity) return;
    sendWs({
      type: 'peer:update',
      alias: aliasRef.current,
      discoverable: discoverableRef.current,
      unattendedEnabled: unattendedEnabledRef.current,
      unattendedHash: unattendedHashRef.current,
      hosting: localMonitorsRef.current.length > 0,
      monitorsCount: Math.max(1, localMonitorsRef.current.length),
      publicKeyJwk: identity.publicKeyJwk,
      fingerprint: identity.fingerprint,
    });
  }, [sendWs]);

  const sendEncryptedControl = useCallback(
    async (packet: ControlPacket) => {
      const session = activeSessionRef.current;
      const aesKey = aesKeyRef.current;
      if (!session || !aesKey) return;

      const sealed = await encryptPayload(aesKey, packet);
      const envelope = JSON.stringify({ kind: 'e2e', sessionId: session.sessionId, ...sealed });

      const dc = dcRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(envelope);
      } else {
        sendWs({
          type: 'relay:message',
          sessionId: session.sessionId,
          sealed,
        });
      }
    },
    [sendWs]
  );

  const applySenderQuality = useCallback(async (preset: QualityPreset) => {
    const pc = pcRef.current;
    if (!pc) return;
    const maxBitrate =
      preset === 'low-latency' ? 4_000_000 : preset === 'balanced' ? 1_800_000 : 650_000;
    const maxFramerate = preset === 'low-latency' ? 60 : preset === 'balanced' ? 30 : 15;
    const scaleDown = preset === 'data-saver' ? 1.5 : 1;

    for (const sender of pc.getSenders()) {
      if (sender.track && sender.track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = maxBitrate;
          params.encodings[0].maxFramerate = maxFramerate;
          params.encodings[0].scaleResolutionDownBy = scaleDown;
          await sender.setParameters(params);
        } catch {
          // Some browsers ignore dynamic scaleResolutionDownBy on screen tracks
        }
      }
    }
  }, []);

  const handleControlPacket = useCallback(
    async (packet: ControlPacket) => {
      const session = activeSessionRef.current;
      if (!session) return;

      if (packet.kind === 'monitors:update') {
        setRemoteMonitors(packet.monitors);
        setActiveMonitorId((prev) => {
          if (prev === 'all') return packet.monitors.length > 1 ? 'all' : packet.monitors[0]?.id || 'all';
          const exists = packet.monitors.some((m) => m.id === prev);
          return exists ? prev : packet.monitors[0]?.id || 'all';
        });
        return;
      }

      if (packet.kind === 'monitor:select') {
        setActiveMonitorId(packet.monitorId);
        return;
      }

      if (packet.kind === 'quality:set') {
        setQualityPresetState(packet.preset);
        if (session.role === 'host') {
          await applySenderQuality(packet.preset);
        }
        return;
      }

      if (packet.kind === 'relay:stream-mode') {
        setManualCloudStream(packet.enabled);
        return;
      }

      if (packet.kind === 'screen:frame') {
        if (!session.permissions.viewScreen) return;
        const counter = relayFpsCounterRef.current;
        counter.count += 1;
        const now = Date.now();
        const elapsed = (now - counter.windowStart) / 1000;
        if (elapsed >= 1) {
          counter.fps = Math.round(counter.count / elapsed);
          counter.count = 0;
          counter.windowStart = now;
        }
        setRemoteRelayFrames((prev) => ({
          ...prev,
          [packet.monitorId]: {
            monitorId: packet.monitorId,
            label: packet.label,
            dataUrl: packet.dataUrl,
            width: packet.width,
            height: packet.height,
            timestamp: packet.timestamp,
          },
        }));
        setRemoteMonitors((prev) => {
          if (prev.some((m) => m.id === packet.monitorId)) return prev;
          return [
            ...prev,
            {
              id: packet.monitorId,
              trackId: packet.monitorId,
              label: packet.label,
              width: packet.width,
              height: packet.height,
              primary: prev.length === 0,
            },
          ];
        });
        setRtcStats((prev) => ({
          ...prev,
          width: packet.width,
          height: packet.height,
          fps: counter.fps || prev.fps || 6,
          codec: 'E2E-JPEG',
          candidateType: prev.candidateType || 'wss-relay',
          transportMode: 'cloud-frame-relay',
        }));
        return;
      }

      if (packet.kind === 'clipboard:sync') {
        if (!session.permissions.clipboardSync) return;
        const item: ClipboardItem = {
          id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text: packet.text,
          source: 'remote',
          senderAlias: packet.senderAlias,
          timestamp: packet.timestamp,
        };
        setClipboardHistory((prev) => [item, ...prev].slice(0, 30));
        if (autoClipboardRef.current && navigator.clipboard?.writeText && document.hasFocus()) {
          navigator.clipboard.writeText(packet.text).catch(() => {});
        }
        return;
      }

      if (packet.kind === 'chat:message') {
        setChatMessages((prev) => [
          ...prev,
          {
            id: packet.id,
            sender: 'remote',
            senderAlias: packet.senderAlias,
            text: packet.text,
            timestamp: packet.timestamp,
          },
        ]);
        return;
      }

      if (packet.kind === 'input:pointer') {
        if (!session.permissions.remoteInput) return;
        setRemotePointer((prev) => ({
          ...prev,
          x: packet.x,
          y: packet.y,
          visible: true,
          clicking: packet.event === 'down',
          senderAlias: packet.senderAlias,
          updatedAt: Date.now(),
        }));
        if (pointerTimeoutRef.current) window.clearTimeout(pointerTimeoutRef.current);
        pointerTimeoutRef.current = window.setTimeout(() => {
          setRemotePointer((prev) => ({ ...prev, visible: false, clicking: false }));
        }, 4000);
        return;
      }

      if (packet.kind === 'input:key') {
        if (!session.permissions.remoteInput) return;
        const combo = [
          packet.ctrl ? 'Ctrl' : '',
          packet.alt ? 'Alt' : '',
          packet.meta ? 'Cmd' : '',
          packet.shift && packet.key.length > 1 ? 'Shift' : '',
          packet.key,
        ]
          .filter(Boolean)
          .join('+');
        setRemotePointer((prev) => ({
          ...prev,
          visible: true,
          lastKey: combo,
          updatedAt: Date.now(),
        }));
        return;
      }

      if (packet.kind === 'file:meta') {
        if (!session.permissions.fileTransfer) return;
        const acc: IncomingFileAccumulator = {
          id: packet.id,
          name: packet.name,
          size: packet.size,
          mimeType: packet.mimeType,
          sha256: packet.sha256,
          totalChunks: packet.totalChunks,
          receivedChunks: new Array(packet.totalChunks),
          receivedCount: 0,
          receivedBytes: 0,
          startedAt: Date.now(),
          lastRateCheckAt: Date.now(),
          lastRateBytes: 0,
        };
        fileAccumulatorsRef.current.set(packet.id, acc);
        setFileTransfers((prev) => [
          {
            id: packet.id,
            name: packet.name,
            size: packet.size,
            mimeType: packet.mimeType,
            direction: 'download',
            transferredBytes: 0,
            status: 'transferring',
            speedBps: 0,
            sha256: packet.sha256,
            startedAt: acc.startedAt,
          },
          ...prev,
        ]);

        // Handle 0-byte file edge case
        if (packet.totalChunks === 0) {
          const blob = new Blob([], { type: packet.mimeType || 'application/octet-stream' });
          const downloadUrl = URL.createObjectURL(blob);
          setFileTransfers((prev) =>
            prev.map((f) =>
              f.id === packet.id
                ? { ...f, status: 'completed', verified: true, downloadUrl }
                : f
            )
          );
          fileAccumulatorsRef.current.delete(packet.id);
        }
        return;
      }

      if (packet.kind === 'file:chunk') {
        const acc = fileAccumulatorsRef.current.get(packet.id);
        if (!acc) return;
        if (!acc.receivedChunks[packet.index]) {
          const buf = base64ToArrayBuffer(packet.dataB64);
          acc.receivedChunks[packet.index] = buf;
          acc.receivedCount += 1;
          acc.receivedBytes += buf.byteLength;
        }

        const now = Date.now();
        const elapsed = (now - acc.lastRateCheckAt) / 1000;
        let speedBps = 0;
        if (elapsed >= 0.25 || acc.receivedCount === acc.totalChunks) {
          const totalElapsed = Math.max(0.05, (now - acc.startedAt) / 1000);
          speedBps = acc.receivedBytes / totalElapsed;
          acc.lastRateCheckAt = now;
          acc.lastRateBytes = acc.receivedBytes;
        }

        const done = acc.receivedCount >= acc.totalChunks;
        if (!done) {
          if (speedBps > 0 || acc.receivedCount % 4 === 0) {
            setFileTransfers((prev) =>
              prev.map((f) =>
                f.id === packet.id
                  ? {
                      ...f,
                      transferredBytes: acc.receivedBytes,
                      speedBps: speedBps || f.speedBps,
                    }
                  : f
              )
            );
          }
          return;
        }

        setFileTransfers((prev) =>
          prev.map((f) =>
            f.id === packet.id
              ? { ...f, transferredBytes: acc.size, status: 'verifying' }
              : f
          )
        );

        const blob = new Blob(
          acc.receivedChunks.filter((c): c is ArrayBuffer => Boolean(c)),
          { type: acc.mimeType || 'application/octet-stream' }
        );
        const fullBuf = await blob.arrayBuffer();
        const digest = await sha256Buffer(fullBuf);
        const verified = !acc.sha256 || digest === acc.sha256;
        const downloadUrl = URL.createObjectURL(blob);

        setFileTransfers((prev) =>
          prev.map((f) =>
            f.id === packet.id
              ? {
                  ...f,
                  transferredBytes: acc.size,
                  status: verified ? 'completed' : 'failed',
                  verified,
                  downloadUrl,
                  error: verified ? undefined : 'SHA-256 integrity check failed',
                }
              : f
          )
        );
        fileAccumulatorsRef.current.delete(packet.id);
      }
    },
    [applySenderQuality]
  );

  const cleanupPeerConnection = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    aesKeyRef.current = null;
    prevStatsRef.current = null;
    remoteTrackCounterRef.current = 0;
    setRemoteStreams({});
    setRemoteRelayFrames({});
    setRemoteMonitors([]);
    setActiveMonitorId('all');
    setManualCloudStream(false);
    setIceState('new');
    setRtcStats({
      rttMs: null,
      fps: null,
      bitrateKbps: null,
      width: null,
      height: null,
      codec: null,
      candidateType: null,
      transportMode: 'e2e-relay',
      iceState: 'new',
    });
  }, []);

  const endSession = useCallback(
    (reason = 'Session closed by user') => {
      const current = activeSessionRef.current;
      const pending = pendingOutgoing;
      if (current) {
        sendWs({
          type: 'session:end',
          sessionId: current.sessionId,
          reason,
        });
      } else if (pending) {
        sendWs({
          type: 'session:end',
          sessionId: pending.sessionId,
          reason,
        });
      }
      cleanupPeerConnection();
      setActiveSession(null);
      setPendingOutgoing(null);
    },
    [cleanupPeerConnection, pendingOutgoing, sendWs]
  );

  const wireDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc;
      dc.onopen = () => {
        setRtcStats((prev) => ({ ...prev, transportMode: 'webrtc-p2p' }));
        if (activeSessionRef.current?.role === 'host' && localMonitorsRef.current.length > 0) {
          sendEncryptedControl({
            kind: 'monitors:update',
            monitors: localMonitorsRef.current.map((m) => m.info),
          });
        }
      };
      dc.onclose = () => {
        setRtcStats((prev) => ({ ...prev, transportMode: 'e2e-relay' }));
      };
      dc.onmessage = async (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as {
            kind?: string;
            iv?: string;
            ct?: string;
          };
          if (parsed.kind === 'e2e' && parsed.iv && parsed.ct && aesKeyRef.current) {
            const decrypted = await decryptPayload<ControlPacket>(aesKeyRef.current, {
              iv: parsed.iv,
              ct: parsed.ct,
            });
            await handleControlPacket(decrypted);
          }
        } catch {
          // Ignore malformed packet
        }
      };
    },
    [handleControlPacket, sendEncryptedControl]
  );

  const createPeerConnection = useCallback(
    (sessionId: string, role: 'host' | 'viewer') => {
      cleanupPeerConnection();
      const pc = new RTCPeerConnection(buildRtcConfig(turnConfigRef.current));
      pcRef.current = pc;

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          sendWs({
            type: 'rtc:signal',
            sessionId,
            signalType: 'ice',
            candidate: evt.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const nextIce = pc.iceConnectionState;
        setIceState(nextIce);
        setRtcStats((prev) => ({
          ...prev,
          iceState: nextIce,
          transportMode:
            nextIce === 'connected' || nextIce === 'completed'
              ? 'webrtc-p2p'
              : prev.transportMode === 'cloud-frame-relay'
              ? 'cloud-frame-relay'
              : 'e2e-relay',
        }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setRtcStats((prev) => ({
            ...prev,
            transportMode:
              dcRef.current?.readyState === 'open' ||
              pc.iceConnectionState === 'connected' ||
              pc.iceConnectionState === 'completed'
                ? 'webrtc-p2p'
                : prev.transportMode,
          }));
        }
      };

      if (role === 'host') {
        const dc = pc.createDataChannel('opendesk-e2e', { ordered: true });
        wireDataChannel(dc);

        // Attach any active local monitor streams
        for (const mon of localMonitorsRef.current) {
          const videoTrack = mon.stream.getVideoTracks()[0];
          const audioTrack = mon.stream.getAudioTracks()[0];
          if (videoTrack) {
            mon.videoSender = pc.addTrack(videoTrack, mon.stream);
          }
          if (audioTrack) {
            mon.audioSender = pc.addTrack(audioTrack, mon.stream);
          }
        }
      } else {
        pc.ondatachannel = (evt) => {
          wireDataChannel(evt.channel);
        };

        pc.ontrack = (evt) => {
          const track = evt.track;
          if (track.kind !== 'video' && track.kind !== 'audio') return;

          const stream = evt.streams[0] || new MediaStream([track]);
          const streamKey = stream.id || track.id;
          if (track.kind === 'video') {
            setRemoteStreams((prev) => ({
              ...prev,
              [streamKey]: stream,
              [track.id]: stream,
            }));

            setRemoteMonitors((prev) => {
              if (prev.some((m) => m.streamId === stream.id || m.trackId === track.id)) return prev;
              const idx = remoteTrackCounterRef.current + 1;
              remoteTrackCounterRef.current = idx;
              const settings = track.getSettings();
              const info: MonitorInfo = {
                id: streamKey,
                trackId: track.id,
                streamId: stream.id,
                label: `Display ${idx}`,
                width: settings.width || 1920,
                height: settings.height || 1080,
                primary: idx === 1,
              };
              return [...prev, info];
            });

            track.onended = () => {
              setRemoteStreams((prev) => {
                const copy = { ...prev };
                delete copy[streamKey];
                delete copy[track.id];
                return copy;
              });
              setRemoteMonitors((prev) =>
                prev.filter((m) => m.streamId !== stream.id && m.trackId !== track.id)
              );
            };
          } else if (track.kind === 'audio') {
            setRemoteStreams((prev) => ({
              ...prev,
              [`audio_${track.id}`]: stream,
            }));
          }
        };
      }

      return pc;
    },
    [cleanupPeerConnection, sendWs, wireDataChannel]
  );

  const sendHostOffer = useCallback(
    async (sessionId: string) => {
      const pc = pcRef.current;
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWs({
        type: 'rtc:signal',
        sessionId,
        signalType: 'offer',
        sdp: pc.localDescription,
      });
    },
    [sendWs]
  );

  const acceptIncomingSession = useCallback(
    async (
      req: IncomingSessionRequest,
      permissions: SessionPermissions,
      captureScreenNow = false
    ) => {
      const identity = identityRef.current;
      if (!identity) return;

      // Capture screen synchronously in click gesture if requested
      if (captureScreenNow && canHostScreen && localMonitorsRef.current.length === 0) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 60 }, cursor: 'always' } as MediaTrackConstraints,
            audio: permissions.audio,
          });
          const vTrack = stream.getVideoTracks()[0];
          const settings = vTrack?.getSettings();
          const monId = `mon_${Date.now()}`;
          const info: MonitorInfo = {
            id: monId,
            trackId: vTrack.id,
            streamId: stream.id,
            label: vTrack.label || 'Display 1',
            width: settings?.width || 1920,
            height: settings?.height || 1080,
            primary: true,
          };
          const newEntry: LocalMonitorTrack = { info, stream };
          localMonitorsRef.current = [newEntry];
          setLocalMonitors([newEntry]);

          vTrack.onended = () => {
            localMonitorsRef.current = localMonitorsRef.current.filter((m) => m.info.id !== monId);
            setLocalMonitors([...localMonitorsRef.current]);
            syncRegistrationToServer();
            sendEncryptedControl({
              kind: 'monitors:update',
              monitors: localMonitorsRef.current.map((m) => m.info),
            });
          };
          syncRegistrationToServer();
        } catch {
          // User canceled screen picker; still accept data/clipboard/file session
        }
      }

      const sec = await deriveSessionSecurity(identity.privateKey, req.fromPublicKeyJwk);
      aesKeyRef.current = sec.aesKey;

      const session: ActiveSession = {
        sessionId: req.sessionId,
        role: 'host',
        remoteDeskId: req.fromDeskId,
        remoteAlias: req.fromAlias,
        remotePlatform: req.fromPlatform,
        remotePublicKeyJwk: req.fromPublicKeyJwk,
        remoteFingerprint: req.fromFingerprint,
        sasCode: sec.sasCode,
        sasPhrase: sec.sasPhrase,
        permissions,
        startedAt: Date.now(),
      };

      activeSessionRef.current = session;
      setActiveSession(session);
      setIncomingRequest(null);
      setSessionError(null);
      setFileTransfers([]);
      setChatMessages([]);
      setClipboardHistory([]);

      createPeerConnection(req.sessionId, 'host');
      await applySenderQuality(qualityPreset);

      sendWs({
        type: 'session:response',
        sessionId: req.sessionId,
        accepted: true,
        permissions,
      });

      await sendHostOffer(req.sessionId);
    },
    [
      applySenderQuality,
      canHostScreen,
      createPeerConnection,
      qualityPreset,
      sendEncryptedControl,
      sendHostOffer,
      sendWs,
      syncRegistrationToServer,
    ]
  );

  const rejectIncomingSession = useCallback(
    (req: IncomingSessionRequest, reason = 'Connection declined by remote user.') => {
      sendWs({
        type: 'session:response',
        sessionId: req.sessionId,
        accepted: false,
        reason,
      });
      setIncomingRequest(null);
    },
    [sendWs]
  );

  // Initialize tab-safe Desk ID & ECDH identity keys, then open WebSocket
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let bc: BroadcastChannel | null = null;

    async function boot() {
      let primaryId = localStorage.getItem(STORAGE_DESK_ID);
      if (!primaryId) {
        primaryId = generateDeskId();
        localStorage.setItem(STORAGE_DESK_ID, primaryId);
      }

      // Detect if another live tab in this same browser already owns primaryId
      let useTabSession = false;
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('opendesk_tab_ownership');
        const claimedByOther = await new Promise<boolean>((resolve) => {
          let settled = false;
          const onMsg = (ev: MessageEvent) => {
            if (ev.data?.type === 'claimed' && ev.data?.deskId === primaryId) {
              settled = true;
              resolve(true);
            }
          };
          bc!.addEventListener('message', onMsg);
          bc!.postMessage({ type: 'probe', deskId: primaryId });
          window.setTimeout(() => {
            bc?.removeEventListener('message', onMsg);
            if (!settled) resolve(false);
          }, 90);
        });

        if (claimedByOther) {
          useTabSession = true;
        }
      }

      if (cancelled) return;

      let activeId = primaryId;
      if (useTabSession) {
        let tabId = sessionStorage.getItem(STORAGE_DESK_ID);
        if (!tabId || tabId === primaryId) {
          tabId = generateDeskId();
          sessionStorage.setItem(STORAGE_DESK_ID, tabId);
        }
        activeId = tabId;
        setIsSecondaryTab(true);
        setAliasState((prev) => (prev.includes('Tab 2') ? prev : `${prev} (Tab 2)`));
      } else if (bc) {
        bc.addEventListener('message', (ev: MessageEvent) => {
          if (ev.data?.type === 'probe' && ev.data?.deskId === activeId) {
            bc?.postMessage({ type: 'claimed', deskId: activeId });
          }
        });
      }

      const identity = await loadOrCreateIdentityKeys(useTabSession ? sessionStorage : localStorage);
      if (cancelled) return;

      identityRef.current = identity;
      deskIdRef.current = activeId;
      setDeskId(activeId);
      setFingerprint(identity.fingerprint);

      const handleInboundSignal = async (msg: Record<string, unknown>) => {
        const type = String(msg.type || '');

        if (type === 'peer:registered' || type === 'directory:update') {
          const list = (msg.peers as PeerDirectoryEntry[]) || [];
          setOnlinePeers(list.filter((p) => p.deskId !== deskIdRef.current));
          return;
        }

        if (type === 'session:incoming') {
          const req: IncomingSessionRequest = {
            sessionId: String(msg.sessionId),
            fromDeskId: String(msg.fromDeskId),
            fromAlias: String(msg.fromAlias),
            fromPlatform: msg.fromPlatform as PlatformOS,
            fromPublicKeyJwk: msg.fromPublicKeyJwk as JsonWebKey,
            fromFingerprint: String(msg.fromFingerprint),
            autoAccepted: Boolean(msg.autoAccepted),
          };
          if (req.autoAccepted && unattendedEnabledRef.current) {
            await acceptIncomingSession(req, defaultPermissionsRef.current, false);
          } else {
            setIncomingRequest(req);
          }
          return;
        }

        if (type === 'session:requested') {
          setPendingOutgoing({
            sessionId: String(msg.sessionId),
            targetDeskId: String(msg.targetDeskId),
            targetAlias: String(msg.targetAlias),
            targetPlatform: msg.targetPlatform as PlatformOS,
          });
          return;
        }

        if (type === 'session:accepted') {
          const idKeys = identityRef.current;
          if (!idKeys) return;
          const hostJwk = msg.hostPublicKeyJwk as JsonWebKey;
          const sec = await deriveSessionSecurity(idKeys.privateKey, hostJwk);
          aesKeyRef.current = sec.aesKey;

          const session: ActiveSession = {
            sessionId: String(msg.sessionId),
            role: 'viewer',
            remoteDeskId: String(msg.hostDeskId),
            remoteAlias: String(msg.hostAlias),
            remotePlatform: msg.hostPlatform as PlatformOS,
            remotePublicKeyJwk: hostJwk,
            remoteFingerprint: String(msg.hostFingerprint),
            sasCode: sec.sasCode,
            sasPhrase: sec.sasPhrase,
            permissions: (msg.permissions as SessionPermissions) || DEFAULT_PERMISSIONS,
            startedAt: Date.now(),
          };
          activeSessionRef.current = session;
          setActiveSession(session);
          setPendingOutgoing(null);
          setSessionError(null);
          setFileTransfers([]);
          setChatMessages([]);
          setClipboardHistory([]);

          setSavedDesks((prev) => {
            const existing = prev.find((d) => d.deskId === session.remoteDeskId);
            const updated: SavedDesk[] = existing
              ? prev.map((d) =>
                  d.deskId === session.remoteDeskId
                    ? {
                        ...d,
                        alias: session.remoteAlias,
                        platform: session.remotePlatform,
                        fingerprint: session.remoteFingerprint,
                        lastConnectedAt: Date.now(),
                      }
                    : d
                )
              : [
                  {
                    deskId: session.remoteDeskId,
                    alias: session.remoteAlias,
                    platform: session.remotePlatform,
                    group: 'Recent',
                    fingerprint: session.remoteFingerprint,
                    lastConnectedAt: Date.now(),
                  },
                  ...prev,
                ];
            localStorage.setItem(STORAGE_SAVED_DESKS, JSON.stringify(updated));
            return updated;
          });

          createPeerConnection(session.sessionId, 'viewer');

          // Drain any WebRTC offers/ICE candidates that arrived while deriving ECDH session keys
          const queued = pendingRtcSignalsRef.current.get(session.sessionId);
          if (queued && queued.length > 0) {
            pendingRtcSignalsRef.current.delete(session.sessionId);
            for (const qMsg of queued) {
              await handleInboundSignal(qMsg);
            }
          }
          return;
        }

        if (type === 'session:rejected' || type === 'session:error') {
          setPendingOutgoing(null);
          setSessionError(String(msg.reason || msg.message || 'Connection failed.'));
          return;
        }

        if (type === 'session:ended') {
          cleanupPeerConnection();
          setActiveSession(null);
          setPendingOutgoing(null);
          setIncomingRequest(null);
          setStatusNotice(String(msg.reason || 'Session ended.'));
          return;
        }

        if (type === 'rtc:signal') {
          const msgSessionId = String(msg.sessionId || '');
          const pc = pcRef.current;
          const session = activeSessionRef.current;
          if (!pc || !session || msgSessionId !== session.sessionId) {
            // Queue signal until viewer finishes deriving ECDH keys and builds RTCPeerConnection
            if (msgSessionId) {
              const list = pendingRtcSignalsRef.current.get(msgSessionId) || [];
              list.push(msg);
              pendingRtcSignalsRef.current.set(msgSessionId, list);
            }
            return;
          }

          const signalType = String(msg.signalType || '');
          if (signalType === 'offer' && msg.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
            for (const cand of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceRef.current = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
              type: 'rtc:signal',
              sessionId: session.sessionId,
              signalType: 'answer',
              sdp: pc.localDescription,
            });
          } else if (signalType === 'answer' && msg.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
            for (const cand of pendingIceRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceRef.current = [];
          } else if (signalType === 'ice' && msg.candidate) {
            const cand = msg.candidate as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            } else {
              pendingIceRef.current.push(cand);
            }
          }
          return;
        }

        if (type === 'relay:message') {
          const session = activeSessionRef.current;
          const aesKey = aesKeyRef.current;
          const sealed = msg.sealed as { iv: string; ct: string } | undefined;
          if (!session || !aesKey || !sealed || msg.sessionId !== session.sessionId) return;
          try {
            const packet = await decryptPayload<ControlPacket>(aesKey, sealed);
            await handleControlPacket(packet);
          } catch {
            // ignore decryption mismatch
          }
        }
      };

      // BroadcastChannel local fallback for static GitHub.io / Pages without remote WS relay
      if (typeof BroadcastChannel !== 'undefined') {
        const signalBc = new BroadcastChannel('opendesk_local_signaling_v1');
        localSignalBcRef.current = signalBc;

        const publishLocalPresence = (kind = 'local:presence') => {
          signalBc.postMessage({
            type: kind,
            _senderDeskId: deskIdRef.current,
            peer: {
              deskId: deskIdRef.current,
              alias: aliasRef.current,
              platform,
              fingerprint: identityRef.current?.fingerprint || '',
              publicKeyJwk: identityRef.current?.publicKeyJwk || {},
              unattendedEnabled: unattendedEnabledRef.current,
              hosting: localMonitorsRef.current.length > 0,
              monitorsCount: Math.max(1, localMonitorsRef.current.length),
              connectedAt: Date.now(),
            },
          });
        };

        signalBc.addEventListener('message', async (ev: MessageEvent) => {
          const msg = ev.data as Record<string, unknown>;
          if (!msg || msg._senderDeskId === deskIdRef.current) return;
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
          if (mqttClientRef.current) return;

          const type = String(msg.type || '');
          if (type === 'local:presence' || type === 'local:hello') {
            const peer = msg.peer as PeerDirectoryEntry | undefined;
            if (peer && peer.deskId) {
              localPeersMapRef.current.set(peer.deskId, peer);
              setOnlinePeers(Array.from(localPeersMapRef.current.values()));
              if (type === 'local:hello') publishLocalPresence('local:presence');
            }
            return;
          }

          if (type === 'local:bye') {
            const goneId = String(msg._senderDeskId || '');
            localPeersMapRef.current.delete(goneId);
            setOnlinePeers(Array.from(localPeersMapRef.current.values()));
            return;
          }

          if (type === 'session:request') {
            const targetDeskId = String(msg.targetDeskId || '');
            if (targetDeskId !== deskIdRef.current) return;
            await handleInboundSignal({
              type: 'session:incoming',
              sessionId: msg.sessionId,
              fromDeskId: msg._senderDeskId,
              fromAlias: msg._senderAlias,
              fromPlatform: msg._senderPlatform,
              fromPublicKeyJwk: msg._senderPublicKeyJwk,
              fromFingerprint: msg._senderFingerprint,
              autoAccepted: false,
            });
            return;
          }

          if (type === 'session:response') {
            if (msg.accepted) {
              await handleInboundSignal({
                type: 'session:accepted',
                sessionId: msg.sessionId,
                permissions: msg.permissions,
                hostDeskId: msg._senderDeskId,
                hostAlias: msg._senderAlias,
                hostPlatform: msg._senderPlatform,
                hostPublicKeyJwk: msg._senderPublicKeyJwk,
                hostFingerprint: msg._senderFingerprint,
              });
            } else {
              await handleInboundSignal({
                type: 'session:rejected',
                sessionId: msg.sessionId,
                reason: msg.reason,
              });
            }
            return;
          }

          if (type === 'session:end' || type === 'rtc:signal' || type === 'relay:message') {
            await handleInboundSignal(msg);
          }
        });

        publishLocalPresence('local:hello');
      }

      const startFreeCloudRelay = () => {
        if (cancelled || mqttClientRef.current) return;
        setWsStatus('connecting');
        const client = new FreeCloudRelayClient(
          {
            deskId: deskIdRef.current,
            alias: aliasRef.current,
            platform,
            publicKeyJwk: identityRef.current?.publicKeyJwk || {},
            fingerprint: identityRef.current?.fingerprint || '',
            discoverable: discoverableRef.current,
            unattendedEnabled: unattendedEnabledRef.current,
            unattendedHash: unattendedHashRef.current,
            hosting: localMonitorsRef.current.length > 0,
            monitorsCount: Math.max(1, localMonitorsRef.current.length),
            room: relayRoomRef.current,
          },
          {
            onConnect: (brokerUrl) => {
              if (cancelled) return;
              setActiveBrokerUrl(brokerUrl);
              setWsStatus('connected');
              setWsMode('free-cloud');
            },
            onDisconnect: () => {
              if (cancelled) return;
              setWsStatus('disconnected');
              setWsMode('broadcast-local');
            },
            onSignalMessage: async (msg) => {
              await handleInboundSignal(msg);
            },
          }
        );
        mqttClientRef.current = client;
        client.connect();
      };

      const connectSocket = () => {
        if (cancelled) return;
        if (relayModeRef.current === 'free-cloud') {
          startFreeCloudRelay();
          return;
        }

        setWsStatus('connecting');
        let everOpened = false;
        try {
          ws = new WebSocket(signalingUrlRef.current);
        } catch {
          if (relayModeRef.current === 'auto') {
            startFreeCloudRelay();
          } else {
            setWsStatus('disconnected');
            setWsMode('broadcast-local');
          }
          return;
        }
        wsRef.current = ws;

        ws.onopen = () => {
          everOpened = true;
          setActiveBrokerUrl(null);
          setWsStatus('connected');
          setWsMode('websocket');
          ws?.send(
            JSON.stringify({
              type: 'peer:register',
              deskId: deskIdRef.current,
              alias: aliasRef.current,
              platform,
              publicKeyJwk: identityRef.current?.publicKeyJwk,
              fingerprint: identityRef.current?.fingerprint,
              discoverable: discoverableRef.current,
              unattendedEnabled: unattendedEnabledRef.current,
              unattendedHash: unattendedHashRef.current,
              hosting: localMonitorsRef.current.length > 0,
              monitorsCount: Math.max(1, localMonitorsRef.current.length),
            })
          );
        };

        ws.onclose = () => {
          if (cancelled) return;
          if (!everOpened && relayModeRef.current === 'auto') {
            wsRef.current = null;
            startFreeCloudRelay();
            return;
          }
          setWsStatus('disconnected');
          setWsMode('broadcast-local');
          reconnectTimer = window.setTimeout(connectSocket, 4000);
        };

        ws.onmessage = async (event) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          } catch {
            return;
          }
          await handleInboundSignal(msg);
        };
      };

      connectSocket();
    }

    boot();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
      if (mqttClientRef.current) {
        mqttClientRef.current.disconnect();
        mqttClientRef.current = null;
      }
      if (localSignalBcRef.current) {
        localSignalBcRef.current.postMessage({
          type: 'local:bye',
          _senderDeskId: deskIdRef.current,
        });
        localSignalBcRef.current.close();
        localSignalBcRef.current = null;
      }
      if (bc) bc.close();
      cleanupPeerConnection();
    };
  }, [
    acceptIncomingSession,
    cleanupPeerConnection,
    createPeerConnection,
    handleControlPacket,
    platform,
    relayModeSetting,
    relayRoom,
    sendWs,
    signalingUrl,
  ]);

  // Real WebRTC stats polling strictly during active WebRTC sessions
  useEffect(() => {
    if (!activeSession) return;
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rttMs: number | null = null;
        let fps: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let totalBytes = 0;
        let codec: string | null = null;
        let candidateType: string | null = null;
        const codecs = new Map<string, string>();
        const localCands = new Map<string, string>();

        stats.forEach((report) => {
          if (report.type === 'codec' && report.mimeType) {
            codecs.set(report.id, String(report.mimeType).replace('video/', '').toUpperCase());
          }
          if (report.type === 'local-candidate' && report.candidateType) {
            localCands.set(report.id, String(report.candidateType));
          }
        });

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number') {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
            if (report.localCandidateId && localCands.has(report.localCandidateId)) {
              candidateType = localCands.get(report.localCandidateId) || null;
            }
          }
          if (
            (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') &&
            report.kind === 'video'
          ) {
            if (typeof report.framesPerSecond === 'number') {
              fps = Math.round(report.framesPerSecond);
            }
            if (typeof report.frameWidth === 'number') width = report.frameWidth;
            if (typeof report.frameHeight === 'number') height = report.frameHeight;
            if (typeof report.bytesReceived === 'number') totalBytes += report.bytesReceived;
            if (typeof report.bytesSent === 'number') totalBytes += report.bytesSent;
            if (report.codecId && codecs.has(report.codecId)) {
              codec = codecs.get(report.codecId) || null;
            }
          }
        });

        const now = Date.now();
        let bitrateKbps: number | null = null;
        if (prevStatsRef.current && totalBytes > prevStatsRef.current.bytes) {
          const dt = (now - prevStatsRef.current.ts) / 1000;
          if (dt > 0) {
            bitrateKbps = Math.round(((totalBytes - prevStatsRef.current.bytes) * 8) / dt / 1000);
          }
        }
        prevStatsRef.current = { bytes: totalBytes, ts: now };

        setRtcStats((prev) => ({
          rttMs,
          fps: fps ?? (prev.transportMode === 'cloud-frame-relay' ? prev.fps : null),
          bitrateKbps,
          width: width ?? (prev.transportMode === 'cloud-frame-relay' ? prev.width : null),
          height: height ?? (prev.transportMode === 'cloud-frame-relay' ? prev.height : null),
          codec: codec ?? (prev.transportMode === 'cloud-frame-relay' ? prev.codec : null),
          candidateType: candidateType ?? prev.candidateType,
          iceState: pc.iceConnectionState,
          transportMode:
            pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
              ? 'webrtc-p2p'
              : prev.transportMode === 'cloud-frame-relay'
              ? 'cloud-frame-relay'
              : dcRef.current?.readyState === 'open'
              ? 'webrtc-p2p'
              : 'e2e-relay',
        }));
      } catch {
        // ignore transient getStats errors
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeSession]);

  // Automatic Free E2E Encrypted Cloud Video Relay fallback when WebRTC ICE fails across NAT/firewalls
  useEffect(() => {
    if (!activeSession || activeSession.role !== 'host' || localMonitors.length === 0) {
      return;
    }
    const p2pHealthy = iceState === 'connected' || iceState === 'completed';
    if (p2pHealthy && !manualCloudStream) {
      return;
    }

    let cancelled = false;
    let captureTimer: number | null = null;
    let sending = false;
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.playsInline = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const startDelay = manualCloudStream || iceState === 'failed' || iceState === 'disconnected' ? 150 : 5000;

    const bootFallbackCapture = () => {
      if (cancelled) return;
      const runTick = async () => {
        if (cancelled) return;
        const currSession = activeSessionRef.current;
        const monitors = localMonitorsRef.current;
        const aesKey = aesKeyRef.current;
        if (!currSession || monitors.length === 0 || !aesKey || sending || !ctx) {
          captureTimer = window.setTimeout(runTick, 200);
          return;
        }

        const pc = pcRef.current;
        const nowHealthy =
          pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
        if (nowHealthy && !manualCloudStreamRef.current) {
          return;
        }

        const targetMonitor =
          monitors.find((m) => m.info.id === activeMonitorIdRef.current) || monitors[0];

        if (videoEl.srcObject !== targetMonitor.stream) {
          videoEl.srcObject = targetMonitor.stream;
          await videoEl.play().catch(() => {});
        }

        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          sending = true;
          try {
            const maxW =
              qualityPreset === 'low-latency' ? 960 : qualityPreset === 'balanced' ? 800 : 640;
            const scale = Math.min(1, maxW / videoEl.videoWidth);
            const targetW = Math.max(320, Math.round(videoEl.videoWidth * scale));
            const targetH = Math.max(180, Math.round(videoEl.videoHeight * scale));
            if (canvas.width !== targetW || canvas.height !== targetH) {
              canvas.width = targetW;
              canvas.height = targetH;
            }
            ctx.drawImage(videoEl, 0, 0, targetW, targetH);

            let jpegQuality = qualityPreset === 'data-saver' ? 0.42 : 0.56;
            let dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
            if (dataUrl.length > 75000) {
              jpegQuality = 0.36;
              dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
            }

            const sealed = await encryptPayload(aesKey, {
              kind: 'screen:frame',
              monitorId: targetMonitor.info.id,
              label: targetMonitor.info.label,
              width: targetW,
              height: targetH,
              dataUrl,
              timestamp: Date.now(),
            } satisfies ControlPacket);

            sendWs({
              type: 'relay:message',
              sessionId: currSession.sessionId,
              sealed,
            });
          } catch {
            // ignore transient frame capture error
          } finally {
            sending = false;
          }
        }

        const intervalMs =
          qualityPreset === 'low-latency' ? 140 : qualityPreset === 'balanced' ? 190 : 280;
        captureTimer = window.setTimeout(runTick, intervalMs);
      };

      runTick();
    };

    const delayTimer = window.setTimeout(bootFallbackCapture, startDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(delayTimer);
      if (captureTimer) window.clearTimeout(captureTimer);
      videoEl.srcObject = null;
    };
  }, [activeSession, iceState, localMonitors, manualCloudStream, qualityPreset, sendWs]);

  // Host: Capture a display (supports adding multiple monitors!)
  const addHostMonitor = useCallback(async () => {
    if (!canHostScreen) {
      setSessionError(
        'Screen capture hosting (getDisplayMedia) is not supported on this mobile browser. You can still control remote desktops, transfer files, and sync clipboards.'
      );
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60 }, cursor: 'always' } as MediaTrackConstraints,
        audio: true,
      });

      const vTrack = stream.getVideoTracks()[0];
      const aTrack = stream.getAudioTracks()[0];
      if (!vTrack) return false;

      const settings = vTrack.getSettings();
      const index = localMonitorsRef.current.length + 1;
      const monId = `mon_${Date.now()}_${index}`;
      const info: MonitorInfo = {
        id: monId,
        trackId: vTrack.id,
        streamId: stream.id,
        label: vTrack.label ? `${vTrack.label.slice(0, 28)}` : `Display ${index}`,
        width: settings.width || 1920,
        height: settings.height || 1080,
        primary: index === 1,
      };

      const entry: LocalMonitorTrack = { info, stream };
      const pc = pcRef.current;
      const session = activeSessionRef.current;
      if (pc && session && session.role === 'host') {
        entry.videoSender = pc.addTrack(vTrack, stream);
        if (aTrack) {
          entry.audioSender = pc.addTrack(aTrack, stream);
        }
      }

      const nextList = [...localMonitorsRef.current, entry];
      localMonitorsRef.current = nextList;
      setLocalMonitors(nextList);
      syncRegistrationToServer();

      if (pc && session && session.role === 'host') {
        await applySenderQuality(qualityPreset);
        await sendHostOffer(session.sessionId);
        await sendEncryptedControl({
          kind: 'monitors:update',
          monitors: nextList.map((m) => m.info),
        });
      }

      vTrack.onended = async () => {
        const remaining = localMonitorsRef.current.filter((m) => m.info.id !== monId);
        const currentPc = pcRef.current;
        const currentSess = activeSessionRef.current;
        if (currentPc && entry.videoSender) {
          try {
            currentPc.removeTrack(entry.videoSender);
          } catch {
            // ignore
          }
        }
        if (currentPc && entry.audioSender) {
          try {
            currentPc.removeTrack(entry.audioSender);
          } catch {
            // ignore
          }
        }
        localMonitorsRef.current = remaining;
        setLocalMonitors(remaining);
        syncRegistrationToServer();
        if (currentPc && currentSess && currentSess.role === 'host') {
          await sendHostOffer(currentSess.sessionId);
          await sendEncryptedControl({
            kind: 'monitors:update',
            monitors: remaining.map((m) => m.info),
          });
        }
      };

      return true;
    } catch {
      return false;
    }
  }, [
    applySenderQuality,
    canHostScreen,
    qualityPreset,
    sendEncryptedControl,
    sendHostOffer,
    syncRegistrationToServer,
  ]);

  const removeHostMonitor = useCallback(
    async (monitorId: string) => {
      const target = localMonitorsRef.current.find((m) => m.info.id === monitorId);
      if (!target) return;

      target.stream.getTracks().forEach((t) => t.stop());
      const pc = pcRef.current;
      const session = activeSessionRef.current;
      if (pc) {
        if (target.videoSender) {
          try {
            pc.removeTrack(target.videoSender);
          } catch {
            // ignore
          }
        }
        if (target.audioSender) {
          try {
            pc.removeTrack(target.audioSender);
          } catch {
            // ignore
          }
        }
      }

      const remaining = localMonitorsRef.current.filter((m) => m.info.id !== monitorId);
      localMonitorsRef.current = remaining;
      setLocalMonitors(remaining);
      syncRegistrationToServer();

      if (pc && session && session.role === 'host') {
        await sendHostOffer(session.sessionId);
        await sendEncryptedControl({
          kind: 'monitors:update',
          monitors: remaining.map((m) => m.info),
        });
      }
    },
    [sendEncryptedControl, sendHostOffer, syncRegistrationToServer]
  );

  const connectToDesk = useCallback(
    async (rawDeskId: string, passcode = '') => {
      const targetDeskId = normalizeDeskId(rawDeskId);
      if (targetDeskId.length < 6) {
        setSessionError('Please enter a valid 9-digit Desk ID.');
        return;
      }
      setSessionError(null);
      setStatusNotice(null);
      const passcodeHash = passcode ? await hashPasscode(passcode) : '';
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      sendWs({
        type: 'session:request',
        sessionId,
        targetDeskId,
        passcodeHash,
      });
    },
    [sendWs]
  );

  const cancelOutgoing = useCallback(() => {
    if (!pendingOutgoing) return;
    sendWs({
      type: 'session:end',
      sessionId: pendingOutgoing.sessionId,
      reason: 'Connection request canceled',
    });
    setPendingOutgoing(null);
  }, [pendingOutgoing, sendWs]);

  const setQualityPreset = useCallback(
    async (preset: QualityPreset) => {
      setQualityPresetState(preset);
      if (activeSessionRef.current?.role === 'host') {
        await applySenderQuality(preset);
      } else if (activeSessionRef.current?.role === 'viewer') {
        await sendEncryptedControl({ kind: 'quality:set', preset });
      }
    },
    [applySenderQuality, sendEncryptedControl]
  );

  const selectMonitor = useCallback(
    (monitorId: string) => {
      setActiveMonitorId(monitorId);
      if (activeSessionRef.current?.role === 'viewer') {
        sendEncryptedControl({ kind: 'monitor:select', monitorId });
      }
    },
    [sendEncryptedControl]
  );

  const sendPointerEvent = useCallback(
    (
      x: number,
      y: number,
      event: 'move' | 'down' | 'up' | 'wheel',
      button?: number,
      deltaY?: number
    ) => {
      const session = activeSessionRef.current;
      if (!session || !session.permissions.remoteInput) return;
      sendEncryptedControl({
        kind: 'input:pointer',
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        event,
        button,
        deltaY,
        senderAlias: aliasRef.current,
      });
    },
    [sendEncryptedControl]
  );

  const sendKeyEvent = useCallback(
    (payload: { key: string; code: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }) => {
      const session = activeSessionRef.current;
      if (!session || !session.permissions.remoteInput) return;
      sendEncryptedControl({
        kind: 'input:key',
        ...payload,
      });
    },
    [sendEncryptedControl]
  );

  const syncClipboard = useCallback(
    async (explicitText?: string) => {
      const session = activeSessionRef.current;
      if (!session || !session.permissions.clipboardSync) return false;

      let text = explicitText;
      if (typeof text !== 'string') {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          return false;
        }
      }
      if (!text) return false;

      const ts = Date.now();
      setClipboardHistory((prev) =>
        [
          {
            id: `clip_${ts}_${Math.random().toString(36).slice(2, 6)}`,
            text,
            source: 'local' as const,
            senderAlias: aliasRef.current,
            timestamp: ts,
          },
          ...prev,
        ].slice(0, 30)
      );

      await sendEncryptedControl({
        kind: 'clipboard:sync',
        text,
        senderAlias: aliasRef.current,
        timestamp: ts,
      });
      return true;
    },
    [sendEncryptedControl]
  );

  const sendChatMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || !activeSessionRef.current) return;
      const msg: SessionChatMessage = {
        id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sender: 'local',
        senderAlias: aliasRef.current,
        text: clean,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, msg]);
      await sendEncryptedControl({
        kind: 'chat:message',
        id: msg.id,
        text: msg.text,
        senderAlias: msg.senderAlias,
        timestamp: msg.timestamp,
      });
    },
    [sendEncryptedControl]
  );

  const sendFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const session = activeSessionRef.current;
      if (!session || !session.permissions.fileTransfer) return;
      const files = Array.from(fileList);

      for (const file of files) {
        const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const startedAt = Date.now();

        setFileTransfers((prev) => [
          {
            id,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            direction: 'upload',
            transferredBytes: 0,
            status: 'pending',
            speedBps: 0,
            startedAt,
          },
          ...prev,
        ]);

        try {
          const buffer = await file.arrayBuffer();
          const digest = await sha256Buffer(buffer);
          const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

          setFileTransfers((prev) =>
            prev.map((f) =>
              f.id === id ? { ...f, status: 'transferring', sha256: digest } : f
            )
          );

          await sendEncryptedControl({
            kind: 'file:meta',
            id,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            sha256: digest,
            totalChunks,
          });

          for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(buffer.byteLength, start + CHUNK_SIZE);
            const slice = buffer.slice(start, end);
            const dataB64 = arrayBufferToBase64(slice);

            // Backpressure guard when streaming over WebRTC DataChannel
            const dc = dcRef.current;
            if (dc && dc.readyState === 'open' && dc.bufferedAmount > 512 * 1024) {
              await new Promise<void>((resolve) => {
                const check = () => {
                  if (!dcRef.current || dcRef.current.bufferedAmount < 128 * 1024) {
                    resolve();
                  } else {
                    window.setTimeout(check, 20);
                  }
                };
                check();
              });
            }

            await sendEncryptedControl({
              kind: 'file:chunk',
              id,
              index: i,
              dataB64,
            });

            if (i % 4 === 0 || i === totalChunks - 1) {
              const elapsed = Math.max(0.05, (Date.now() - startedAt) / 1000);
              setFileTransfers((prev) =>
                prev.map((f) =>
                  f.id === id
                    ? {
                        ...f,
                        transferredBytes: end,
                        speedBps: end / elapsed,
                      }
                    : f
                )
              );
            }
          }

          setFileTransfers((prev) =>
            prev.map((f) =>
              f.id === id
                ? {
                    ...f,
                    transferredBytes: file.size,
                    status: 'completed',
                    verified: true,
                  }
                : f
            )
          );
        } catch {
          setFileTransfers((prev) =>
            prev.map((f) =>
              f.id === id
                ? { ...f, status: 'failed', error: 'Transfer interrupted' }
                : f
            )
          );
        }
      }
    },
    [sendEncryptedControl]
  );

  // Settings & Address Book mutations
  const updateAlias = useCallback(
    (nextAlias: string) => {
      const clean = nextAlias.trim().slice(0, 48) || defaultDeviceAlias(platform);
      setAliasState(clean);
      aliasRef.current = clean;
      localStorage.setItem(STORAGE_ALIAS, clean);
      syncRegistrationToServer();
    },
    [platform, syncRegistrationToServer]
  );

  const updateDiscoverable = useCallback(
    (next: boolean) => {
      setDiscoverableState(next);
      discoverableRef.current = next;
      localStorage.setItem(STORAGE_DISCOVERABLE, String(next));
      syncRegistrationToServer();
    },
    [syncRegistrationToServer]
  );

  const configureUnattendedAccess = useCallback(
    async (enabled: boolean, newPasscode?: string) => {
      let nextHash = unattendedHashRef.current;
      if (typeof newPasscode === 'string') {
        nextHash = newPasscode.trim() ? await hashPasscode(newPasscode) : '';
        setUnattendedHashState(nextHash);
        unattendedHashRef.current = nextHash;
        localStorage.setItem(STORAGE_UNATTENDED_HASH, nextHash);
      }
      const finalEnabled = enabled && Boolean(nextHash);
      setUnattendedEnabledState(finalEnabled);
      unattendedEnabledRef.current = finalEnabled;
      localStorage.setItem(STORAGE_UNATTENDED_ENABLED, String(finalEnabled));
      syncRegistrationToServer();
      return finalEnabled;
    },
    [syncRegistrationToServer]
  );

  const updateDefaultPermissions = useCallback((next: SessionPermissions) => {
    setDefaultPermissionsState(next);
    defaultPermissionsRef.current = next;
    localStorage.setItem(STORAGE_PERMISSIONS, JSON.stringify(next));
  }, []);

  const rotateIdentityKeypair = useCallback(async () => {
    const keys = await regenerateIdentityKeys(isSecondaryTab ? sessionStorage : localStorage);
    identityRef.current = keys;
    setFingerprint(keys.fingerprint);
    syncRegistrationToServer();
    return keys.fingerprint;
  }, [isSecondaryTab, syncRegistrationToServer]);

  const upsertSavedDesk = useCallback((desk: SavedDesk) => {
    const cleanId = normalizeDeskId(desk.deskId);
    if (!cleanId) return;
    setSavedDesks((prev) => {
      const exists = prev.some((d) => d.deskId === cleanId);
      const next = exists
        ? prev.map((d) => (d.deskId === cleanId ? { ...d, ...desk, deskId: cleanId } : d))
        : [{ ...desk, deskId: cleanId }, ...prev];
      localStorage.setItem(STORAGE_SAVED_DESKS, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeSavedDesk = useCallback((targetDeskId: string) => {
    setSavedDesks((prev) => {
      const next = prev.filter((d) => d.deskId !== targetDeskId);
      localStorage.setItem(STORAGE_SAVED_DESKS, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateSignalingUrl = useCallback((nextUrl: string) => {
    const clean = nextUrl.trim();
    if (!clean) {
      localStorage.removeItem(STORAGE_SIGNALING_URL);
      setSignalingUrl(getDefaultSignalingUrl());
    } else {
      localStorage.setItem(STORAGE_SIGNALING_URL, clean);
      setSignalingUrl(clean);
    }
  }, []);

  const waitForIceComplete = (pc: RTCPeerConnection, timeoutMs = 1800) =>
    new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      }, timeoutMs);
      const onState = () => {
        if (pc.iceGatheringState === 'complete') {
          window.clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', onState);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onState);
    });

  const createDirectOfferCode = useCallback(
    async (captureScreen = true): Promise<string | null> => {
      const identity = identityRef.current;
      if (!identity) return null;

      if (captureScreen && canHostScreen && localMonitorsRef.current.length === 0) {
        await addHostMonitor();
      }

      const sessionId = `direct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const pc = createPeerConnection(sessionId, 'host');
      directOfferPcRef.current = pc;

      await applySenderQuality(qualityPreset);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceComplete(pc);

      const bundle = {
        v: 1,
        sessionId,
        deskId: deskIdRef.current,
        alias: aliasRef.current,
        platform,
        publicKeyJwk: identity.publicKeyJwk,
        fingerprint: identity.fingerprint,
        monitors: localMonitorsRef.current.map((m) => m.info),
        sdp: pc.localDescription,
      };
      const json = JSON.stringify(bundle);
      return `OD1:${btoa(unescape(encodeURIComponent(json)))}`;
    },
    [addHostMonitor, applySenderQuality, canHostScreen, createPeerConnection, platform, qualityPreset]
  );

  const acceptDirectOfferCode = useCallback(
    async (rawCode: string): Promise<string> => {
      const identity = identityRef.current;
      if (!identity) throw new Error('Identity keys not ready.');
      const trimmed = rawCode.trim();
      if (!trimmed.startsWith('OD1:')) {
        throw new Error('Invalid invite code format. Expected OD1:...');
      }
      const payload = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(4))))) as {
        sessionId: string;
        deskId: string;
        alias: string;
        platform: PlatformOS;
        publicKeyJwk: JsonWebKey;
        fingerprint: string;
        monitors?: MonitorInfo[];
        sdp: RTCSessionDescriptionInit;
      };

      const sec = await deriveSessionSecurity(identity.privateKey, payload.publicKeyJwk);
      aesKeyRef.current = sec.aesKey;

      const session: ActiveSession = {
        sessionId: payload.sessionId,
        role: 'viewer',
        remoteDeskId: payload.deskId,
        remoteAlias: payload.alias,
        remotePlatform: payload.platform,
        remotePublicKeyJwk: payload.publicKeyJwk,
        remoteFingerprint: payload.fingerprint,
        sasCode: sec.sasCode,
        sasPhrase: sec.sasPhrase,
        permissions: DEFAULT_PERMISSIONS,
        startedAt: Date.now(),
      };
      activeSessionRef.current = session;
      setActiveSession(session);
      setSessionError(null);
      if (payload.monitors && payload.monitors.length > 0) {
        setRemoteMonitors(payload.monitors);
      }

      const pc = createPeerConnection(payload.sessionId, 'viewer');
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceComplete(pc);

      const answerBundle = {
        v: 1,
        sessionId: payload.sessionId,
        deskId: deskIdRef.current,
        alias: aliasRef.current,
        platform,
        publicKeyJwk: identity.publicKeyJwk,
        fingerprint: identity.fingerprint,
        sdp: pc.localDescription,
      };
      return `OD1:${btoa(unescape(encodeURIComponent(JSON.stringify(answerBundle))))}`;
    },
    [createPeerConnection, platform]
  );

  const completeDirectAnswerCode = useCallback(async (rawAnswerCode: string) => {
    const identity = identityRef.current;
    const pc = directOfferPcRef.current || pcRef.current;
    if (!identity || !pc) throw new Error('No pending direct offer found.');

    const trimmed = rawAnswerCode.trim();
    if (!trimmed.startsWith('OD1:')) {
      throw new Error('Invalid answer code format. Expected OD1:...');
    }
    const payload = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(4))))) as {
      sessionId: string;
      deskId: string;
      alias: string;
      platform: PlatformOS;
      publicKeyJwk: JsonWebKey;
      fingerprint: string;
      sdp: RTCSessionDescriptionInit;
    };

    const sec = await deriveSessionSecurity(identity.privateKey, payload.publicKeyJwk);
    aesKeyRef.current = sec.aesKey;

    const session: ActiveSession = {
      sessionId: payload.sessionId,
      role: 'host',
      remoteDeskId: payload.deskId,
      remoteAlias: payload.alias,
      remotePlatform: payload.platform,
      remotePublicKeyJwk: payload.publicKeyJwk,
      remoteFingerprint: payload.fingerprint,
      sasCode: sec.sasCode,
      sasPhrase: sec.sasPhrase,
      permissions: DEFAULT_PERMISSIONS,
      startedAt: Date.now(),
    };
    activeSessionRef.current = session;
    setActiveSession(session);
    setSessionError(null);

    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    directOfferPcRef.current = null;
  }, []);

  const updateRelayMode = useCallback((mode: RelayModeSetting) => {
    localStorage.setItem(STORAGE_RELAY_MODE, mode);
    setRelayModeSetting(mode);
  }, []);

  const updateRelayRoom = useCallback((nextRoom: string) => {
    const clean = nextRoom.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'opendesk-public-v1';
    localStorage.setItem(STORAGE_RELAY_ROOM, clean);
    setRelayRoom(clean);
  }, []);

  const updateTurnConfig = useCallback((next: TurnServerConfig) => {
    const clean: TurnServerConfig = {
      urls: next.urls.trim(),
      username: next.username?.trim() || '',
      credential: next.credential?.trim() || '',
    };
    localStorage.setItem(STORAGE_TURN_CONFIG, JSON.stringify(clean));
    setTurnConfigState(clean);
  }, []);

  const toggleCloudStreamRelay = useCallback(
    async (enabled?: boolean) => {
      const next = typeof enabled === 'boolean' ? enabled : !manualCloudStreamRef.current;
      setManualCloudStream(next);
      await sendEncryptedControl({ kind: 'relay:stream-mode', enabled: next });
    },
    [sendEncryptedControl]
  );

  return {
    deskId,
    isSecondaryTab,
    alias,
    platform,
    canHostScreen,
    fingerprint,
    signalingUrl,
    defaultSignalingUrl: getDefaultSignalingUrl(),
    relayModeSetting,
    relayRoom,
    turnConfig,
    activeBrokerUrl,
    wsStatus,
    wsMode,
    discoverable,
    unattendedEnabled,
    hasUnattendedPasscode: Boolean(unattendedHash),
    defaultPermissions,
    onlinePeers,
    savedDesks,
    pendingOutgoing,
    incomingRequest,
    activeSession,
    sessionError,
    statusNotice,
    localMonitors,
    remoteMonitors,
    remoteStreams,
    remoteRelayFrames,
    activeMonitorId,
    manualCloudStream,
    qualityPreset,
    rtcStats,
    clipboardHistory,
    autoClipboardSync,
    fileTransfers,
    chatMessages,
    remotePointer,
    setSessionError,
    setStatusNotice,
    setAutoClipboardSync,
    updateAlias,
    updateSignalingUrl,
    updateRelayMode,
    updateRelayRoom,
    updateTurnConfig,
    toggleCloudStreamRelay,
    updateDiscoverable,
    configureUnattendedAccess,
    updateDefaultPermissions,
    rotateIdentityKeypair,
    upsertSavedDesk,
    removeSavedDesk,
    connectToDesk,
    cancelOutgoing,
    acceptIncomingSession,
    rejectIncomingSession,
    endSession,
    addHostMonitor,
    removeHostMonitor,
    selectMonitor,
    setQualityPreset,
    sendPointerEvent,
    sendKeyEvent,
    syncClipboard,
    sendChatMessage,
    sendFiles,
    createDirectOfferCode,
    acceptDirectOfferCode,
    completeDirectAnswerCode,
  };
}
