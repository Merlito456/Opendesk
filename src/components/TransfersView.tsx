import { Download, FolderSync } from 'lucide-react';
import { formatBytes, formatSpeed } from '../lib/platform';
import type { FileTransferItem } from '../types';

interface TransfersViewProps {
  fileTransfers: FileTransferItem[];
  hasActiveSession: boolean;
  onGoToConnect: () => void;
}

export function TransfersView({
  fileTransfers,
  hasActiveSession,
  onGoToConnect,
}: TransfersViewProps) {
  return (
    <div className="max-w-[1200px] mx-auto p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          File Transfers
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          End-to-end AES-256-GCM encrypted file transfers with SHA-256 integrity verification.
        </p>
      </div>

      <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {fileTransfers.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-3">
            <FolderSync className="w-8 h-8 mx-auto text-slate-400" />
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No file transfers recorded yet
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {hasActiveSession
                ? 'Drag and drop files directly onto the active remote session screen to transfer them.'
                : 'Connect to any remote Desk ID, then drag and drop files directly onto the session screen.'}
            </p>
            {!hasActiveSession && (
              <button
                type="button"
                onClick={onGoToConnect}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Go to Connect
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-6">File Name</th>
                  <th className="py-2.5 px-4">Direction</th>
                  <th className="py-2.5 px-4">Size</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">SHA-256</th>
                  <th className="py-2.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {fileTransfers.map((f) => (
                  <tr key={f.id}>
                    <td className="py-3 px-6 font-medium text-slate-900 dark:text-slate-100">
                      {f.name}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {f.direction === 'upload' ? 'Sent' : 'Received'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatBytes(f.size)}
                    </td>
                    <td className="py-3 px-4">
                      {f.status === 'completed' ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          {f.verified ? 'Verified' : 'Completed'}
                        </span>
                      ) : f.status === 'failed' ? (
                        <span className="font-medium text-red-600">{f.error || 'Failed'}</span>
                      ) : (
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {formatSpeed(f.speedBps)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {f.sha256 ? f.sha256.slice(0, 14) : '—'}
                    </td>
                    <td className="py-3 px-6 text-right">
                      {f.downloadUrl && f.status === 'completed' ? (
                        <a
                          href={f.downloadUrl}
                          download={f.name}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Save</span>
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
