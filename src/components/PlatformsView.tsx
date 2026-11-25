import { useState, type FormEvent } from 'react';
import { Check, Cloud, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDeskId } from '../lib/platform';
import type { PlatformOS } from '../types';
import { PlatformIcon } from './PlatformIcon';

interface PlatformsViewProps {
  deskId: string;
  currentPlatform: PlatformOS;
  signalingUrl: string;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  wsMode: 'websocket' | 'broadcast-local';
  onUpdateSignalingUrl: (next: string) => void;
}

const PLATFORM_MATRIX: {
  os: PlatformOS;
  screenHosting: string;
  remoteControl: string;
  fileAndClipboard: string;
  notes: string;
}[] = [
  {
    os: 'Windows',
    screenHosting: 'Full Display & Multi-Monitor',
    remoteControl: 'Keyboard, Mouse & Shortcut Bridge',
    fileAndClipboard: 'Drag & Drop + Auto Clipboard',
    notes: 'Supports Edge, Chrome, Firefox, and self-hosted desktop shell.',
  },
  {
    os: 'macOS',
    screenHosting: 'Retina Multi-Monitor & Window Capture',
    remoteControl: 'Keyboard, Trackpad & Cmd Shortcuts',
    fileAndClipboard: 'Drag & Drop + Auto Clipboard',
    notes: 'Grant Screen Recording permission when prompted by macOS.',
  },
  {
    os: 'Linux',
    screenHosting: 'X11 & Wayland PipeWire Capture',
    remoteControl: 'Keyboard, Mouse & Multi-Display Switcher',
    fileAndClipboard: 'Drag & Drop + Auto Clipboard',
    notes: 'Works across Ubuntu, Fedora, Arch, and SteamOS desktop mode.',
  },
  {
    os: 'Android',
    screenHosting: 'File, Clipboard & Companion Stream',
    remoteControl: 'Touch Trackpad + Virtual Keyboard',
    fileAndClipboard: 'Drag & Drop + Clipboard Sync',
    notes: 'Scan the QR code below to control any desktop immediately.',
  },
  {
    os: 'iOS',
    screenHosting: 'File, Clipboard & Companion Stream',
    remoteControl: 'Touch Gestures + Quick Key Toolbar',
    fileAndClipboard: 'Files App Upload + Clipboard Sync',
    notes: 'Runs natively in Safari on iPhone and iPad with zero install.',
  },
];

export function PlatformsView({
  deskId,
  currentPlatform,
  signalingUrl,
  wsStatus,
  wsMode,
  onUpdateSignalingUrl,
}: PlatformsViewProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [signalDraft, setSignalDraft] = useState(signalingUrl);
  const [cfPagesUrl, setCfPagesUrl] = useState('https://opendesk.pages.dev');

  const pairUrl =
    typeof window !== 'undefined' && deskId
      ? `${window.location.origin}${window.location.pathname}?connect=${deskId}`
      : '';

  const copyText = async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // ignore
    }
  };

  const normalizedCfOrigin = cfPagesUrl.trim().replace(/\/+$/, '') || 'https://opendesk.pages.dev';

  const githubIoRedirectHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=${normalizedCfOrigin}/" />
    <link rel="canonical" href="${normalizedCfOrigin}/" />
    <title>OpenDesk — Forwarding to Cloudflare Pages</title>
    <script>
      window.location.replace('${normalizedCfOrigin}/' + (window.location.search || '') + (window.location.hash || ''));
    </script>
  </head>
  <body></body>
</html>`;

  const handleSaveSignaling = (e: FormEvent) => {
    e.preventDefault();
    onUpdateSignalingUrl(signalDraft);
  };

  return (
    <div className="max-w-[1200px] mx-auto p-6 lg:p-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Cross-Platform Pairing & Edge Deployment
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deploy via GitHub.io to Cloudflare Pages with Cloudflare Durable Object WebSocket
            signaling across Windows, macOS, Linux, Android, and iOS.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Detected OS:{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">{currentPlatform}</span>
        </div>
      </div>

      {/* Instant Mobile & Cross-Device Pairing */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="p-3 bg-white border border-slate-200 rounded-xl w-fit">
          {pairUrl ? <QRCodeSVG value={pairUrl} size={136} /> : <div className="w-34 h-34" />}
        </div>

        <div className="space-y-3 min-w-0">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Instant Cross-Device Link for Desk {formatDeskId(deskId)}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Scan this QR code from an Android phone, iPhone, iPad, or open the link on any
              Windows, macOS, or Linux browser to establish an end-to-end authenticated WebRTC
              session with this device.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 truncate max-w-md">
              {pairUrl}
            </div>
            <button
              type="button"
              onClick={() => copyText('pair', pairUrl)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedKey === 'pair' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied Link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
            <a
              href={`./?connect=${deskId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>Launch Companion Tab</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </section>

      {/* GitHub.io -> Cloudflare Pages & Signaling Relay Setup */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-red-600" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                GitHub.io to Cloudflare Pages Setup
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Static assets deploy to Cloudflare Pages via GitHub Actions, your github.io domain
              forwards deep links cleanly, and Cloudflare Durable Objects host global WebSocket
              signaling.
            </p>
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Signaling Mode:{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {wsStatus === 'connected'
                ? 'WebSocket Relay Connected'
                : wsMode === 'broadcast-local'
                ? 'Local Browser Fallback'
                : 'Connecting'}
            </span>
          </div>
        </div>

        {/* Custom WebSocket Signaling URL */}
        <form onSubmit={handleSaveSignaling} className="space-y-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            WebSocket Signaling Endpoint (Cloudflare Worker / VITE_SIGNALING_URL)
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={signalDraft}
              onChange={(e) => setSignalDraft(e.target.value)}
              placeholder="wss://opendesk-signal.your-subdomain.workers.dev/ws"
              className="flex-1 px-3.5 py-2 font-mono text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-red-600"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              Connect Relay
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateSignalingUrl('');
                setSignalDraft('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </form>

        {/* Deployment Steps & Redirect Generator */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              1. Deploy Cloudflare Pages & Durable Object Signaling
            </h3>
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Build Command</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">npm run build</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Output Directory</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">dist</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">GitHub Workflow</span>
                <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
                  .github/workflows/deploy-cloudflare-pages.yml
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <code className="text-[11px] text-slate-800 dark:text-slate-200 truncate">
                  npx wrangler deploy -c cloudflare/wrangler.toml
                </code>
                <button
                  type="button"
                  onClick={() =>
                    copyText('wrangler', 'npx wrangler deploy -c cloudflare/wrangler.toml')
                  }
                  className="text-xs font-medium text-red-600 hover:text-red-700 shrink-0"
                >
                  {copiedKey === 'wrangler' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                2. Forward github.io to Cloudflare Pages
              </h3>
              <button
                type="button"
                onClick={() => copyText('redirect', githubIoRedirectHtml)}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                {copiedKey === 'redirect' ? 'Copied HTML' : 'Copy index.html'}
              </button>
            </div>
            <input
              type="url"
              value={cfPagesUrl}
              onChange={(e) => setCfPagesUrl(e.target.value)}
              placeholder="https://opendesk.pages.dev"
              aria-label="Target Cloudflare Pages URL"
              className="w-full px-3 py-1.5 font-mono text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
            <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto max-h-32">
              {githubIoRedirectHtml}
            </pre>
          </div>
        </div>
      </section>

      {/* Capability Matrix Table */}
      <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Platform Matrix
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-6">Operating System</th>
                <th className="py-2.5 px-4">Screen Capture</th>
                <th className="py-2.5 px-4">Input Control</th>
                <th className="py-2.5 px-4">Files & Clipboard</th>
                <th className="py-2.5 px-6">Runtime Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {PLATFORM_MATRIX.map((row) => (
                <tr
                  key={row.os}
                  className={
                    row.os === currentPlatform ? 'bg-slate-50 dark:bg-slate-800/40' : ''
                  }
                >
                  <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <PlatformIcon
                        platform={row.os}
                        className="w-4 h-4 text-slate-600 dark:text-slate-300"
                      />
                      <span>{row.os}</span>
                      {row.os === currentPlatform && (
                        <span className="text-[11px] font-medium text-red-600">· Current</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                    {row.screenHosting}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                    {row.remoteControl}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                    {row.fileAndClipboard}
                  </td>
                  <td className="py-3.5 px-6 text-slate-500 dark:text-slate-400">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
