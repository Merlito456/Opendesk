import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  MonitorUp,
  Pencil,
  QrCode,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDeskId, normalizeDeskId } from '../lib/platform';
import type {
  MonitorInfo,
  PeerDirectoryEntry,
  PlatformOS,
  SavedDesk,
} from '../types';
import { PlatformIcon } from './PlatformIcon';

interface ConnectWorkspaceProps {
  deskId: string;
  isSecondaryTab: boolean;
  alias: string;
  platform: PlatformOS;
  canHostScreen: boolean;
  fingerprint: string;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  wsMode: 'websocket' | 'broadcast-local';
  localMonitors: { info: MonitorInfo; stream: MediaStream }[];
  onlinePeers: PeerDirectoryEntry[];
  savedDesks: SavedDesk[];
  pendingOutgoing: {
    sessionId: string;
    targetDeskId: string;
    targetAlias?: string;
    targetPlatform?: PlatformOS;
  } | null;
  sessionError: string | null;
  statusNotice: string | null;
  initialTargetDeskId?: string;
  onDismissAlerts: () => void;
  onUpdateAlias: (next: string) => void;
  onAddHostMonitor: () => Promise<boolean>;
  onRemoveHostMonitor: (id: string) => Promise<void>;
  onConnect: (deskId: string, passcode?: string) => Promise<void>;
  onCancelOutgoing: () => void;
  onSaveDesk: (desk: SavedDesk) => void;
  onCreateDirectOffer: (captureScreen?: boolean) => Promise<string | null>;
  onAcceptDirectOffer: (code: string) => Promise<string>;
  onCompleteDirectAnswer: (code: string) => Promise<void>;
}

export function ConnectWorkspace({
  deskId,
  isSecondaryTab,
  alias,
  platform,
  canHostScreen,
  fingerprint,
  wsStatus,
  wsMode,
  localMonitors,
  onlinePeers,
  savedDesks,
  pendingOutgoing,
  sessionError,
  statusNotice,
  initialTargetDeskId = '',
  onDismissAlerts,
  onUpdateAlias,
  onAddHostMonitor,
  onRemoveHostMonitor,
  onConnect,
  onCancelOutgoing,
  onSaveDesk,
  onCreateDirectOffer,
  onAcceptDirectOffer,
  onCompleteDirectAnswer,
}: ConnectWorkspaceProps) {
  const [targetInput, setTargetInput] = useState(() => formatDeskId(initialTargetDeskId));
  const [passcodeInput, setPasscodeInput] = useState('');
  const [showPasscodeField, setShowPasscodeField] = useState(false);
  const [showDirectP2P, setShowDirectP2P] = useState(false);
  const [directOfferOut, setDirectOfferOut] = useState('');
  const [directOfferIn, setDirectOfferIn] = useState('');
  const [directAnswerOut, setDirectAnswerOut] = useState('');
  const [directAnswerIn, setDirectAnswerIn] = useState('');
  const [directBusy, setDirectBusy] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(alias);
  const [showQrModal, setShowQrModal] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | 'online' | 'saved'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const formattedOwnId = formatDeskId(deskId);
  const pairUrl =
    typeof window !== 'undefined' && deskId
      ? `${window.location.origin}${window.location.pathname}?connect=${deskId}`
      : '';

  const copyOwnId = async () => {
    if (!deskId) return;
    try {
      await navigator.clipboard.writeText(deskId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1600);
    } catch {
      // ignore
    }
  };

  const handleConnectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onConnect(targetInput, passcodeInput);
  };

  // Merge live online peers + saved desks into a unified directory list
  const onlineMap = new Map(onlinePeers.map((p) => [p.deskId, p]));
  const savedMap = new Map(savedDesks.map((d) => [d.deskId, d]));

  const combinedRows: {
    deskId: string;
    alias: string;
    platform: PlatformOS;
    online: boolean;
    hosting: boolean;
    monitorsCount: number;
    unattendedEnabled: boolean;
    saved: boolean;
    fingerprint?: string;
  }[] = [];

  for (const peer of onlinePeers) {
    const saved = savedMap.get(peer.deskId);
    combinedRows.push({
      deskId: peer.deskId,
      alias: saved?.alias || peer.alias,
      platform: peer.platform,
      online: true,
      hosting: peer.hosting,
      monitorsCount: peer.monitorsCount,
      unattendedEnabled: peer.unattendedEnabled,
      saved: Boolean(saved),
      fingerprint: peer.fingerprint,
    });
  }

  for (const saved of savedDesks) {
    if (!onlineMap.has(saved.deskId)) {
      combinedRows.push({
        deskId: saved.deskId,
        alias: saved.alias,
        platform: saved.platform,
        online: false,
        hosting: false,
        monitorsCount: 1,
        unattendedEnabled: false,
        saved: true,
        fingerprint: saved.fingerprint,
      });
    }
  }

  const filteredRows = combinedRows.filter((row) => {
    if (listFilter === 'online' && !row.online) return false;
    if (listFilter === 'saved' && !row.saved) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        row.alias.toLowerCase().includes(q) ||
        row.deskId.includes(q.replace(/\s/g, '')) ||
        row.platform.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="max-w-[1200px] mx-auto p-6 lg:p-8 space-y-8">
      {/* Inline Session Error or Notice */}
      {(sessionError || statusNotice) && (
        <div
          className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg border text-sm ${
            sessionError
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300'
              : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
          }`}
        >
          <span>{sessionError || statusNotice}</span>
          <button
            type="button"
            onClick={onDismissAlerts}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pending Outgoing Connection Banner */}
      {pendingOutgoing && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Waiting for authorization from{' '}
              {pendingOutgoing.targetAlias || formatDeskId(pendingOutgoing.targetDeskId)}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Desk {formatDeskId(pendingOutgoing.targetDeskId)} · Verifying ECDH P-256 session keys
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelOutgoing}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Cancel Request
          </button>
        </div>
      )}

      {/* Top Two-Column Split: This Desk | Remote Desk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Left: This Desk Identity & Host Controls */}
        <section className="flex flex-col justify-between p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  This Desk Address
                </span>
                <div className="flex items-center gap-3">
                  <div className="font-mono text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                    {formattedOwnId || '··· ··· ···'}
                  </div>
                  <button
                    type="button"
                    onClick={copyOwnId}
                    disabled={!deskId}
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    aria-label="Copy Desk ID"
                    title="Copy Desk ID"
                  >
                    {copiedId ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="text-right text-xs text-slate-500 dark:text-slate-400 space-y-0.5 shrink-0">
                <div className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>
                    {wsStatus === 'connected'
                      ? 'Relay Ready · Encrypted'
                      : wsMode === 'broadcast-local'
                      ? 'Local Mode · Encrypted'
                      : 'Connecting'}
                  </span>
                </div>
                <div className="font-mono text-[11px] tabular-nums">
                  {fingerprint ? fingerprint.slice(0, 11) : ''}
                </div>
              </div>
            </div>

            {/* Editable Device Alias + Platform Info */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <PlatformIcon platform={platform} className="w-3.5 h-3.5 shrink-0" />
              <span>{platform}</span>
              <span aria-hidden="true">·</span>

              {editingAlias ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onUpdateAlias(aliasDraft);
                    setEditingAlias(false);
                  }}
                  className="inline-flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    autoFocus
                    className="px-2 py-0.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                  <button
                    type="submit"
                    className="px-2 py-0.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAliasDraft(alias);
                    setEditingAlias(true);
                  }}
                  className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 hover:text-red-600 transition-colors"
                >
                  <span>{alias}</span>
                  <Pencil className="w-3 h-3 opacity-60" />
                </button>
              )}

              {isSecondaryTab && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Companion Session</span>
                </>
              )}
            </div>

            {/* Active Shared Monitors Preview List */}
            {localMonitors.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Active Shared Displays ({localMonitors.length})
                </div>
                <div className="space-y-1.5">
                  {localMonitors.map((m, idx) => (
                    <div
                      key={m.info.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          Display {idx + 1}: {m.info.label}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          {m.info.width}×{m.info.height}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveHostMonitor(m.info.id)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 shrink-0"
                      >
                        Stop
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Host Action Row */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            {canHostScreen && (
              <button
                type="button"
                onClick={onAddHostMonitor}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MonitorUp className="w-3.5 h-3.5" />
                <span>{localMonitors.length > 0 ? 'Add Another Monitor' : 'Pre-Share Screen'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowQrModal((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Pair Mobile (QR)</span>
            </button>

            <a
              href={`./?connect=${deskId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <span>Open Companion Tab</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {showQrModal && deskId && (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="p-2 bg-white rounded-lg shrink-0">
                <QRCodeSVG value={pairUrl} size={96} />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Scan from Android, iOS, or another laptop
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Opens OpenDesk pre-targeted to Desk {formattedOwnId} with end-to-end key
                  verification.
                </p>
                <div className="font-mono text-[11px] text-slate-500 truncate">{pairUrl}</div>
              </div>
            </div>
          )}
        </section>

        {/* Right: Remote Desk Connection Form */}
        <section className="flex flex-col justify-between p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <form onSubmit={handleConnectSubmit} className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Connect to Remote Desk
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter the 9-digit address of any Windows, macOS, Linux, Android, or iOS device.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={targetInput}
                  onChange={(e) => setTargetInput(formatDeskId(e.target.value))}
                  placeholder="000 000 000"
                  aria-label="Remote Desk Address"
                  className="flex-1 px-4 py-3 font-mono text-xl tracking-wider rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600 tabular-nums"
                />
                <button
                  type="submit"
                  disabled={normalizeDeskId(targetInput).length < 6 || Boolean(pendingOutgoing)}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Connect</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowPasscodeField((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>
                    {showPasscodeField
                      ? 'Hide Unattended Passcode'
                      : 'Use Unattended Access Passcode'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDirectP2P((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>{showDirectP2P ? 'Hide Direct P2P Pair' : 'Direct P2P Pair (No Server)'}</span>
                </button>
              </div>

              {showPasscodeField && (
                <input
                  type="password"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  placeholder="Optional unattended access passcode"
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-red-600"
                />
              )}
            </div>
          </form>

          {showDirectP2P && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Serverless Direct WebRTC Handshake
              </div>
              <p className="text-slate-500 dark:text-slate-400">
                Connect across any two networks on static hosting (GitHub.io / Cloudflare Pages) by
                exchanging an encrypted Offer & Answer token directly.
              </p>

              {directError && (
                <div className="text-red-600 font-medium">{directError}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Host Flow */}
                <div className="space-y-2 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Host This Screen
                  </div>
                  <button
                    type="button"
                    disabled={directBusy}
                    onClick={async () => {
                      setDirectBusy(true);
                      setDirectError(null);
                      try {
                        const code = await onCreateDirectOffer(true);
                        if (code) setDirectOfferOut(code);
                      } catch (err) {
                        setDirectError(err instanceof Error ? err.message : 'Failed to create invite.');
                      } finally {
                        setDirectBusy(false);
                      }
                    }}
                    className="w-full py-1.5 font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-md disabled:opacity-50"
                  >
                    {directBusy ? 'Gathering ICE...' : '1. Create Offer Code'}
                  </button>
                  {directOfferOut && (
                    <div className="space-y-1.5">
                      <textarea
                        readOnly
                        rows={2}
                        value={directOfferOut}
                        onClick={(e) => {
                          e.currentTarget.select();
                          navigator.clipboard?.writeText(directOfferOut).catch(() => {});
                        }}
                        className="w-full p-2 font-mono text-[10px] rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                      />
                      <input
                        type="text"
                        value={directAnswerIn}
                        onChange={(e) => setDirectAnswerIn(e.target.value)}
                        placeholder="2. Paste Answer Code here..."
                        className="w-full px-2 py-1.5 font-mono text-[11px] rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                      />
                      <button
                        type="button"
                        disabled={!directAnswerIn.trim()}
                        onClick={async () => {
                          setDirectError(null);
                          try {
                            await onCompleteDirectAnswer(directAnswerIn);
                          } catch (err) {
                            setDirectError(err instanceof Error ? err.message : 'Invalid answer code.');
                          }
                        }}
                        className="w-full py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-40"
                      >
                        3. Complete Connection
                      </button>
                    </div>
                  )}
                </div>

                {/* Viewer Flow */}
                <div className="space-y-2 p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Connect to Host
                  </div>
                  <input
                    type="text"
                    value={directOfferIn}
                    onChange={(e) => setDirectOfferIn(e.target.value)}
                    placeholder="Paste Host Offer Code (OD1:...)"
                    className="w-full px-2 py-1.5 font-mono text-[11px] rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                  />
                  <button
                    type="button"
                    disabled={!directOfferIn.trim() || directBusy}
                    onClick={async () => {
                      setDirectBusy(true);
                      setDirectError(null);
                      try {
                        const ans = await onAcceptDirectOffer(directOfferIn);
                        setDirectAnswerOut(ans);
                      } catch (err) {
                        setDirectError(err instanceof Error ? err.message : 'Invalid offer code.');
                      } finally {
                        setDirectBusy(false);
                      }
                    }}
                    className="w-full py-1.5 font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-40"
                  >
                    Generate Answer Code
                  </button>
                  {directAnswerOut && (
                    <textarea
                      readOnly
                      rows={2}
                      value={directAnswerOut}
                      onClick={(e) => {
                        e.currentTarget.select();
                        navigator.clipboard?.writeText(directAnswerOut).catch(() => {});
                      }}
                      placeholder="Send this Answer Code back to Host"
                      className="w-full p-2 font-mono text-[10px] rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-slate-500 dark:text-slate-400">Transport</div>
              <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                WebRTC DTLS + Relay
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Cipher</div>
              <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                ECDH P-256 · AES-256
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">License</div>
              <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                Free · Open Source MIT
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Online Peers & Recent Sessions Table */}
      <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Discovered & Recent Desks
            </h2>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'online', label: `Online (${onlinePeers.length})` },
                  { id: 'saved', label: `Saved (${savedDesks.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setListFilter(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    listFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by alias, ID, or OS..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-red-600"
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-2">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No remote peers online yet
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Open a companion tab, launch OpenDesk on another computer, or scan the QR code from
              your Android or iOS device to see live discoverable peers here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-6">Device Alias</th>
                  <th className="py-2.5 px-4">Desk ID</th>
                  <th className="py-2.5 px-4">Platform</th>
                  <th className="py-2.5 px-4">Availability</th>
                  <th className="py-2.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredRows.map((row) => (
                  <tr
                    key={row.deskId}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-6">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.alias}
                      </div>
                      {row.fingerprint && (
                        <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {row.fingerprint}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                      {formatDeskId(row.deskId)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <PlatformIcon platform={row.platform} className="w-3.5 h-3.5" />
                        <span>{row.platform}</span>
                        {row.online && row.monitorsCount > 1 && (
                          <span className="text-slate-400">· {row.monitorsCount} displays</span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      {row.online ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          Online
                          {row.hosting ? ' · Sharing Screen' : ''}
                          {row.unattendedEnabled ? ' · Unattended' : ''}
                        </span>
                      ) : (
                        <span className="text-slate-400">Offline</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {!row.saved && (
                          <button
                            type="button"
                            onClick={() =>
                              onSaveDesk({
                                deskId: row.deskId,
                                alias: row.alias,
                                platform: row.platform,
                                group: 'Workstations',
                                fingerprint: row.fingerprint,
                              })
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Save to Address Book"
                            aria-label="Save to Address Book"
                          >
                            <Bookmark className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!row.online || Boolean(pendingOutgoing)}
                          onClick={() => onConnect(row.deskId, passcodeInput)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          Connect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
