import { useState, type FormEvent } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { formatDeskId, normalizeDeskId } from '../lib/platform';
import type { PeerDirectoryEntry, PlatformOS, SavedDesk } from '../types';
import { PlatformIcon } from './PlatformIcon';

interface AddressBookViewProps {
  savedDesks: SavedDesk[];
  onlinePeers: PeerDirectoryEntry[];
  onUpsertDesk: (desk: SavedDesk) => void;
  onRemoveDesk: (deskId: string) => void;
  onConnect: (deskId: string) => Promise<void>;
}

const PLATFORMS: ('All' | PlatformOS)[] = ['All', 'Windows', 'macOS', 'Linux', 'Android', 'iOS'];

export function AddressBookView({
  savedDesks,
  onlinePeers,
  onUpsertDesk,
  onRemoveDesk,
  onConnect,
}: AddressBookViewProps) {
  const [platformFilter, setPlatformFilter] = useState<'All' | PlatformOS>('All');
  const [query, setQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const [newDeskId, setNewDeskId] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newPlatform, setNewPlatform] = useState<PlatformOS>('Windows');
  const [newGroup, setNewGroup] = useState('Workstations');

  const onlineMap = new Map(onlinePeers.map((p) => [p.deskId, p]));

  const filtered = savedDesks.filter((d) => {
    if (platformFilter !== 'All' && d.platform !== platformFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        d.alias.toLowerCase().includes(q) ||
        d.deskId.includes(q.replace(/\s/g, '')) ||
        d.group.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const clean = normalizeDeskId(newDeskId);
    if (clean.length < 6) return;
    onUpsertDesk({
      deskId: clean,
      alias: newAlias.trim() || `Desk ${formatDeskId(clean)}`,
      platform: newPlatform,
      group: newGroup.trim() || 'Workstations',
    });
    setNewDeskId('');
    setNewAlias('');
    setShowAddForm(false);
  };

  return (
    <div className="max-w-[1200px] mx-auto p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Address Book
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Saved workstations, servers, and mobile devices across all platforms.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Desk</span>
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
        >
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Desk ID
            </label>
            <input
              type="text"
              required
              value={newDeskId}
              onChange={(e) => setNewDeskId(formatDeskId(e.target.value))}
              placeholder="000 000 000"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Alias
            </label>
            <input
              type="text"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="Studio MacBook"
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Platform
            </label>
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as PlatformOS)}
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="Windows">Windows</option>
              <option value="macOS">macOS</option>
              <option value="Linux">Linux</option>
              <option value="Android">Android</option>
              <option value="iOS">iOS</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Group
            </label>
            <input
              type="text"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Workstations"
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-x-auto">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  platformFilter === p
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search saved desks..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-2">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No saved desks match your filter
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add a remote Desk ID above or connect to a peer to save it automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-6">Alias</th>
                  <th className="py-2.5 px-4">Desk ID</th>
                  <th className="py-2.5 px-4">Platform · Group</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filtered.map((desk) => {
                  const live = onlineMap.get(desk.deskId);
                  return (
                    <tr
                      key={desk.deskId}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-6 font-medium text-slate-900 dark:text-slate-100">
                        {desk.alias}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatDeskId(desk.deskId)}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformIcon platform={live?.platform || desk.platform} className="w-3.5 h-3.5" />
                          <span>{live?.platform || desk.platform}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-400">{desk.group}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {live ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            Online
                          </span>
                        ) : (
                          <span className="text-slate-400">Offline</span>
                        )}
                      </td>
                      <td className="py-3 px-6 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onRemoveDesk(desk.deskId)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            aria-label="Delete saved desk"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={!live}
                            onClick={() => onConnect(desk.deskId)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors"
                          >
                            Connect
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
