import { useState } from 'react';
import { MonitorUp, ShieldCheck, X } from 'lucide-react';
import { formatDeskId } from '../lib/platform';
import type { IncomingSessionRequest, SessionPermissions } from '../types';
import { PlatformIcon } from './PlatformIcon';

interface IncomingRequestModalProps {
  request: IncomingSessionRequest;
  defaultPermissions: SessionPermissions;
  canHostScreen: boolean;
  hasActiveMonitors: boolean;
  onAccept: (
    req: IncomingSessionRequest,
    permissions: SessionPermissions,
    captureScreenNow: boolean
  ) => void;
  onReject: (req: IncomingSessionRequest) => void;
}

export function IncomingRequestModal({
  request,
  defaultPermissions,
  canHostScreen,
  hasActiveMonitors,
  onAccept,
  onReject,
}: IncomingRequestModalProps) {
  const [permissions, setPermissions] = useState<SessionPermissions>(defaultPermissions);

  const toggle = (key: keyof SessionPermissions) => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-request-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-500 shrink-0" />
            <h2
              id="incoming-request-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Incoming Connection Request
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onReject(request)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Decline request"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="space-y-1 min-w-0">
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                {request.fromAlias}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <PlatformIcon platform={request.fromPlatform} className="w-3.5 h-3.5 shrink-0" />
                <span>{request.fromPlatform}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{formatDeskId(request.fromDeskId)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Caller ECDH P-256 Key Fingerprint
            </div>
            <div className="font-mono text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 tabular-nums">
              {request.fromFingerprint}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Session Permissions
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { key: 'viewScreen' as const, label: 'View Displays' },
                { key: 'remoteInput' as const, label: 'Remote Mouse & Keyboard' },
                { key: 'fileTransfer' as const, label: 'Drag & Drop Files' },
                { key: 'clipboardSync' as const, label: 'Clipboard Synchronization' },
                { key: 'audio' as const, label: 'System Audio' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={permissions[item.key]}
                    onChange={() => toggle(item.key)}
                    className="rounded border-slate-300 text-red-600 focus:ring-red-600"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onReject(request)}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Decline
          </button>

          {canHostScreen && permissions.viewScreen && !hasActiveMonitors ? (
            <>
              <button
                type="button"
                onClick={() => onAccept(request, permissions, false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Accept Without Screen
              </button>
              <button
                type="button"
                onClick={() => onAccept(request, permissions, true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MonitorUp className="w-3.5 h-3.5" />
                <span>Accept & Share Screen</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onAccept(request, permissions, false)}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Accept Connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
