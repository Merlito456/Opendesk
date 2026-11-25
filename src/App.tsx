import { useEffect, useState } from 'react';
import {
  BookUser,
  FolderSync,
  Globe,
  Menu,
  Monitor,
  MonitorUp,
  Moon,
  Shield,
  Sun,
  X,
} from 'lucide-react';
import { ActiveSessionWorkspace } from './components/ActiveSessionWorkspace';
import { AddressBookView } from './components/AddressBookView';
import { ConnectWorkspace } from './components/ConnectWorkspace';
import { IncomingRequestModal } from './components/IncomingRequestModal';
import { OpenDeskMark } from './components/PlatformIcon';
import { PlatformsView } from './components/PlatformsView';
import { SecurityView } from './components/SecurityView';
import { TransfersView } from './components/TransfersView';
import { useOpenDesk } from './hooks/useOpenDesk';
import { formatDeskId, normalizeDeskId } from './lib/platform';

type NavTab = 'connect' | 'address-book' | 'transfers' | 'platforms' | 'security';

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof Monitor }[] = [
  { id: 'connect', label: 'Connect', icon: Monitor },
  { id: 'address-book', label: 'Address Book', icon: BookUser },
  { id: 'transfers', label: 'File Transfers', icon: FolderSync },
  { id: 'platforms', label: 'Platforms & QR', icon: Globe },
  { id: 'security', label: 'Security & Keys', icon: Shield },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('connect');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showSessionView, setShowSessionView] = useState(true);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('opendesk_theme');
    if (saved) return saved === 'dark';
    return false;
  });

  const [initialTargetDeskId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return normalizeDeskId(params.get('connect') || '');
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('opendesk_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('opendesk_theme', 'light');
    }
  }, [darkMode]);

  const desk = useOpenDesk();

  // Auto-switch into active session workspace whenever a session begins
  useEffect(() => {
    if (desk.activeSession) {
      setShowSessionView(true);
    }
  }, [desk.activeSession]);

  const inSessionViewport = Boolean(desk.activeSession && showSessionView);
  const currentTabMeta = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const handleSelectNav = (tab: NavTab) => {
    setActiveTab(tab);
    setShowSessionView(false);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
      {!inSessionViewport && (
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
          <div className="h-14 flex items-center gap-2.5 px-5 border-b border-slate-200 dark:border-slate-800">
            <OpenDeskMark className="w-6 h-6 shrink-0" />
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              OpenDesk
            </span>
          </div>

          <nav className="flex-1 p-3 space-y-1" aria-label="Primary Navigation">
            {desk.activeSession && (
              <button
                type="button"
                onClick={() => setShowSessionView(true)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors mb-2"
              >
                <span className="truncate">Active: {desk.activeSession.remoteAlias}</span>
                <span className="shrink-0">Open</span>
              </button>
            )}

            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNav(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-red-600' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-1 text-xs">
            <div className="text-slate-500 dark:text-slate-400">Your Desk ID</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {desk.deskId ? formatDeskId(desk.deskId) : '··· ··· ···'}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              MIT Open Source · {desk.platform}
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Slide-Over Sidebar */}
      {mobileMenuOpen && !inSessionViewport && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10">
            <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <OpenDeskMark className="w-6 h-6" />
                <span className="font-display text-base font-bold">OpenDesk</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-500"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-red-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 flex items-center justify-between gap-4 px-4 lg:px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {!inSessionViewport ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSessionView(false)}
                className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 hover:text-red-600 transition-colors whitespace-nowrap shrink-0"
              >
                <OpenDeskMark className="w-5 h-5" />
                <span className="font-display">OpenDesk</span>
              </button>
            )}

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">
                OpenDesk
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {inSessionViewport ? 'Remote Session' : currentTabMeta.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {desk.activeSession ? (
              inSessionViewport ? (
                <button
                  type="button"
                  onClick={() => setShowSessionView(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Workspace
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSessionView(true)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Return to Session
                </button>
              )
            ) : desk.canHostScreen ? (
              <button
                type="button"
                onClick={desk.addHostMonitor}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MonitorUp className="w-3.5 h-3.5" />
                <span>Share Screen</span>
              </button>
            ) : null}
          </div>
        </header>

        {/* Active View Body */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {inSessionViewport && desk.activeSession ? (
            <ActiveSessionWorkspace
              session={desk.activeSession}
              localFingerprint={desk.fingerprint}
              canHostScreen={desk.canHostScreen}
              localMonitors={desk.localMonitors}
              remoteMonitors={desk.remoteMonitors}
              remoteStreams={desk.remoteStreams}
              activeMonitorId={desk.activeMonitorId}
              qualityPreset={desk.qualityPreset}
              rtcStats={desk.rtcStats}
              clipboardHistory={desk.clipboardHistory}
              autoClipboardSync={desk.autoClipboardSync}
              fileTransfers={desk.fileTransfers}
              chatMessages={desk.chatMessages}
              remotePointer={desk.remotePointer}
              onEndSession={() => desk.endSession('Session disconnected by user')}
              onAddHostMonitor={desk.addHostMonitor}
              onRemoveHostMonitor={desk.removeHostMonitor}
              onSelectMonitor={desk.selectMonitor}
              onSetQualityPreset={desk.setQualityPreset}
              onSendPointer={desk.sendPointerEvent}
              onSendKey={desk.sendKeyEvent}
              onSyncClipboard={desk.syncClipboard}
              onToggleAutoClipboard={desk.setAutoClipboardSync}
              onSendFiles={desk.sendFiles}
              onSendChat={desk.sendChatMessage}
            />
          ) : activeTab === 'connect' ? (
            <ConnectWorkspace
              deskId={desk.deskId}
              isSecondaryTab={desk.isSecondaryTab}
              alias={desk.alias}
              platform={desk.platform}
              canHostScreen={desk.canHostScreen}
              fingerprint={desk.fingerprint}
              wsStatus={desk.wsStatus}
              wsMode={desk.wsMode}
              localMonitors={desk.localMonitors}
              onlinePeers={desk.onlinePeers}
              savedDesks={desk.savedDesks}
              pendingOutgoing={desk.pendingOutgoing}
              sessionError={desk.sessionError}
              statusNotice={desk.statusNotice}
              initialTargetDeskId={initialTargetDeskId}
              onDismissAlerts={() => {
                desk.setSessionError(null);
                desk.setStatusNotice(null);
              }}
              onUpdateAlias={desk.updateAlias}
              onAddHostMonitor={desk.addHostMonitor}
              onRemoveHostMonitor={desk.removeHostMonitor}
              onConnect={desk.connectToDesk}
              onCancelOutgoing={desk.cancelOutgoing}
              onSaveDesk={desk.upsertSavedDesk}
              onCreateDirectOffer={desk.createDirectOfferCode}
              onAcceptDirectOffer={desk.acceptDirectOfferCode}
              onCompleteDirectAnswer={desk.completeDirectAnswerCode}
            />
          ) : activeTab === 'address-book' ? (
            <AddressBookView
              savedDesks={desk.savedDesks}
              onlinePeers={desk.onlinePeers}
              onUpsertDesk={desk.upsertSavedDesk}
              onRemoveDesk={desk.removeSavedDesk}
              onConnect={async (id) => {
                await desk.connectToDesk(id);
                setActiveTab('connect');
              }}
            />
          ) : activeTab === 'transfers' ? (
            <TransfersView
              fileTransfers={desk.fileTransfers}
              hasActiveSession={Boolean(desk.activeSession)}
              onGoToConnect={() => setActiveTab('connect')}
            />
          ) : activeTab === 'platforms' ? (
            <PlatformsView
              deskId={desk.deskId}
              currentPlatform={desk.platform}
              signalingUrl={desk.signalingUrl}
              wsStatus={desk.wsStatus}
              wsMode={desk.wsMode}
              onUpdateSignalingUrl={desk.updateSignalingUrl}
            />
          ) : (
            <SecurityView
              fingerprint={desk.fingerprint}
              discoverable={desk.discoverable}
              unattendedEnabled={desk.unattendedEnabled}
              hasUnattendedPasscode={desk.hasUnattendedPasscode}
              defaultPermissions={desk.defaultPermissions}
              onToggleDiscoverable={desk.updateDiscoverable}
              onConfigureUnattended={desk.configureUnattendedAccess}
              onUpdateDefaultPermissions={desk.updateDefaultPermissions}
              onRotateKeypair={desk.rotateIdentityKeypair}
            />
          )}
        </main>
      </div>

      {/* Global Incoming Connection Modal */}
      {desk.incomingRequest && (
        <IncomingRequestModal
          request={desk.incomingRequest}
          defaultPermissions={desk.defaultPermissions}
          canHostScreen={desk.canHostScreen}
          hasActiveMonitors={desk.localMonitors.length > 0}
          onAccept={desk.acceptIncomingSession}
          onReject={desk.rejectIncomingSession}
        />
      )}
    </div>
  );
}
