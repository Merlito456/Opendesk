import { useState, type FormEvent } from 'react';
import { Check, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { SessionPermissions } from '../types';

interface SecurityViewProps {
  fingerprint: string;
  discoverable: boolean;
  unattendedEnabled: boolean;
  hasUnattendedPasscode: boolean;
  defaultPermissions: SessionPermissions;
  onToggleDiscoverable: (val: boolean) => void;
  onConfigureUnattended: (enabled: boolean, passcode?: string) => Promise<boolean>;
  onUpdateDefaultPermissions: (next: SessionPermissions) => void;
  onRotateKeypair: () => Promise<string>;
}

export function SecurityView({
  fingerprint,
  discoverable,
  unattendedEnabled,
  hasUnattendedPasscode,
  defaultPermissions,
  onToggleDiscoverable,
  onConfigureUnattended,
  onUpdateDefaultPermissions,
  onRotateKeypair,
}: SecurityViewProps) {
  const [passcodeDraft, setPasscodeDraft] = useState('');
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const showSaved = (msg: string) => {
    setSavedFeedback(msg);
    window.setTimeout(() => setSavedFeedback(null), 2200);
  };

  const handleSavePasscode = async (e: FormEvent) => {
    e.preventDefault();
    if (!passcodeDraft.trim()) return;
    await onConfigureUnattended(true, passcodeDraft);
    setPasscodeDraft('');
    showSaved('Unattended access passcode updated (SHA-256 hashed).');
  };

  const handleRotate = async () => {
    setRotating(true);
    await onRotateKeypair();
    setRotating(false);
    showSaved('New ECDH P-256 identity keypair generated.');
  };

  const togglePerm = (key: keyof SessionPermissions) => {
    onUpdateDefaultPermissions({
      ...defaultPermissions,
      [key]: !defaultPermissions[key],
    });
  };

  return (
    <div className="max-w-[1000px] mx-auto p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Security & End-to-End Authentication
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cryptographic device identity, unattended access credentials, and session permissions.
          </p>
        </div>

        {savedFeedback && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="w-4 h-4" />
            <span>{savedFeedback}</span>
          </div>
        )}
      </div>

      {/* ECDH Identity Keypair */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                ECDH P-256 Identity Keypair
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
              Every session derives an ephemeral AES-256-GCM key and a Short Authentication String
              (SAS) directly between peers. Private keys never leave your browser storage.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotating}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`} />
            <span>Rotate Keys</span>
          </button>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Public Key SHA-256 Fingerprint
          </div>
          <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {fingerprint}
          </div>
        </div>
      </section>

      {/* Unattended Access */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Unattended Access
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
              Allow trusted devices that supply your passcode to connect automatically without
              manual approval prompts.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={unattendedEnabled}
              disabled={!hasUnattendedPasscode && !unattendedEnabled}
              onChange={(e) => onConfigureUnattended(e.target.checked)}
              className="rounded border-slate-300 text-red-600 focus:ring-red-600"
            />
            <span>{unattendedEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        <form onSubmit={handleSavePasscode} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="password"
            value={passcodeDraft}
            onChange={(e) => setPasscodeDraft(e.target.value)}
            placeholder={
              hasUnattendedPasscode
                ? 'Enter a new passcode to replace current one...'
                : 'Set an unattended access passcode...'
            }
            className="flex-1 px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
          <button
            type="submit"
            disabled={!passcodeDraft.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Set Passcode
          </button>
        </form>
      </section>

      {/* Discovery & Default Permissions */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Network Directory Visibility
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              List this Desk ID in the Discovered Peers directory for quick one-click access.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={discoverable}
              onChange={(e) => onToggleDiscoverable(e.target.checked)}
              className="rounded border-slate-300 text-red-600 focus:ring-red-600"
            />
            <span>{discoverable ? 'Discoverable' : 'Private (ID Only)'}</span>
          </label>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Default Incoming Session Permissions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {[
              { key: 'viewScreen' as const, label: 'View Remote Displays' },
              { key: 'remoteInput' as const, label: 'Mouse & Keyboard Control' },
              { key: 'fileTransfer' as const, label: 'Drag & Drop File Transfer' },
              { key: 'clipboardSync' as const, label: 'Clipboard Synchronization' },
              { key: 'audio' as const, label: 'System Audio Streaming' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={defaultPermissions[item.key]}
                  onChange={() => togglePerm(item.key)}
                  className="rounded border-slate-300 text-red-600 focus:ring-red-600"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
