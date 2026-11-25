export type PlatformOS = 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS';

export type QualityPreset = 'low-latency' | 'balanced' | 'data-saver';

export interface MonitorInfo {
  id: string;
  trackId: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface SessionPermissions {
  viewScreen: boolean;
  remoteInput: boolean;
  fileTransfer: boolean;
  clipboardSync: boolean;
  audio: boolean;
}

export interface PeerDirectoryEntry {
  deskId: string;
  alias: string;
  platform: PlatformOS;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  unattendedEnabled: boolean;
  hosting: boolean;
  monitorsCount: number;
  connectedAt: number;
}

export interface SavedDesk {
  deskId: string;
  alias: string;
  platform: PlatformOS;
  group: string;
  notes?: string;
  lastConnectedAt?: number;
  fingerprint?: string;
}

export interface ClipboardItem {
  id: string;
  text: string;
  source: 'local' | 'remote';
  senderAlias: string;
  timestamp: number;
}

export interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  direction: 'upload' | 'download';
  transferredBytes: number;
  status: 'pending' | 'transferring' | 'verifying' | 'completed' | 'failed';
  speedBps: number;
  sha256?: string;
  verified?: boolean;
  downloadUrl?: string;
  error?: string;
  startedAt: number;
}

export interface RemotePointerState {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
  senderAlias: string;
  lastKey?: string;
  updatedAt: number;
}

export interface SessionChatMessage {
  id: string;
  sender: 'local' | 'remote';
  senderAlias: string;
  text: string;
  timestamp: number;
}

export interface WebRTCStatsSnapshot {
  rttMs: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  candidateType: string | null;
  transportMode: 'webrtc-p2p' | 'e2e-relay';
}

export interface IncomingSessionRequest {
  sessionId: string;
  fromDeskId: string;
  fromAlias: string;
  fromPlatform: PlatformOS;
  fromPublicKeyJwk: JsonWebKey;
  fromFingerprint: string;
  autoAccepted?: boolean;
}

export interface ActiveSession {
  sessionId: string;
  role: 'viewer' | 'host';
  remoteDeskId: string;
  remoteAlias: string;
  remotePlatform: PlatformOS;
  remotePublicKeyJwk: JsonWebKey;
  remoteFingerprint: string;
  sasPhrase: string;
  sasCode: string;
  permissions: SessionPermissions;
  startedAt: number;
}
