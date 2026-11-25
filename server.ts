import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  PeerDirectoryEntry,
  PlatformOS,
  SessionPermissions,
} from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ConnectedPeer {
  ws: WebSocket;
  deskId: string;
  alias: string;
  platform: PlatformOS;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  discoverable: boolean;
  unattendedEnabled: boolean;
  unattendedHash: string;
  hosting: boolean;
  monitorsCount: number;
  connectedAt: number;
}

interface ActiveServerSession {
  sessionId: string;
  viewerDeskId: string;
  hostDeskId: string;
  createdAt: number;
}

const peers = new Map<string, ConnectedPeer>();
const socketToDeskId = new Map<WebSocket, string>();
const sessions = new Map<string, ActiveServerSession>();

function sendJson(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getPublicDirectory(): PeerDirectoryEntry[] {
  const list: PeerDirectoryEntry[] = [];
  for (const peer of peers.values()) {
    if (peer.discoverable) {
      list.push({
        deskId: peer.deskId,
        alias: peer.alias,
        platform: peer.platform,
        fingerprint: peer.fingerprint,
        publicKeyJwk: peer.publicKeyJwk,
        unattendedEnabled: peer.unattendedEnabled,
        hosting: peer.hosting,
        monitorsCount: peer.monitorsCount,
        connectedAt: peer.connectedAt,
      });
    }
  }
  return list.sort((a, b) => b.connectedAt - a.connectedAt);
}

function broadcastDirectory() {
  const directory = getPublicDirectory();
  for (const peer of peers.values()) {
    sendJson(peer.ws, {
      type: 'directory:update',
      peers: directory,
    });
  }
}

function cleanupPeer(ws: WebSocket) {
  const deskId = socketToDeskId.get(ws);
  if (!deskId) return;

  socketToDeskId.delete(ws);
  const current = peers.get(deskId);
  if (current && current.ws === ws) {
    peers.delete(deskId);

    for (const [sessionId, session] of sessions.entries()) {
      if (session.viewerDeskId === deskId || session.hostDeskId === deskId) {
        const otherDeskId =
          session.viewerDeskId === deskId ? session.hostDeskId : session.viewerDeskId;
        const otherPeer = peers.get(otherDeskId);
        sendJson(otherPeer?.ws, {
          type: 'session:ended',
          sessionId,
          reason: 'Remote peer disconnected',
        });
        sessions.delete(sessionId);
      }
    }

    broadcastDirectory();
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      onlinePeers: peers.size,
      activeSessions: sessions.size,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'peer:register') {
        const deskId = String(msg.deskId || '').replace(/\D/g, '').slice(0, 9);
        if (!deskId) return;

        // Replace stale socket if same deskId reconnects
        const existing = peers.get(deskId);
        if (existing && existing.ws !== ws) {
          socketToDeskId.delete(existing.ws);
          sendJson(existing.ws, {
            type: 'peer:superseded',
            reason: 'Connected from another window with the same Desk ID',
          });
        }

        const peer: ConnectedPeer = {
          ws,
          deskId,
          alias: String(msg.alias || 'Workstation').slice(0, 64),
          platform: (msg.platform as PlatformOS) || 'Linux',
          publicKeyJwk: (msg.publicKeyJwk as JsonWebKey) || {},
          fingerprint: String(msg.fingerprint || ''),
          discoverable: msg.discoverable !== false,
          unattendedEnabled: Boolean(msg.unattendedEnabled),
          unattendedHash: String(msg.unattendedHash || ''),
          hosting: Boolean(msg.hosting),
          monitorsCount: Number(msg.monitorsCount || 1),
          connectedAt: Date.now(),
        };

        peers.set(deskId, peer);
        socketToDeskId.set(ws, deskId);

        sendJson(ws, {
          type: 'peer:registered',
          deskId,
          peers: getPublicDirectory(),
        });
        broadcastDirectory();
        return;
      }

      const senderDeskId = socketToDeskId.get(ws);
      if (!senderDeskId) return;
      const senderPeer = peers.get(senderDeskId);
      if (!senderPeer) return;

      if (type === 'peer:update') {
        if (typeof msg.alias === 'string') {
          senderPeer.alias = msg.alias.slice(0, 64);
        }
        if (typeof msg.discoverable === 'boolean') {
          senderPeer.discoverable = msg.discoverable;
        }
        if (typeof msg.unattendedEnabled === 'boolean') {
          senderPeer.unattendedEnabled = msg.unattendedEnabled;
        }
        if (typeof msg.unattendedHash === 'string') {
          senderPeer.unattendedHash = msg.unattendedHash;
        }
        if (typeof msg.hosting === 'boolean') {
          senderPeer.hosting = msg.hosting;
        }
        if (typeof msg.monitorsCount === 'number') {
          senderPeer.monitorsCount = msg.monitorsCount;
        }
        if (msg.publicKeyJwk && typeof msg.fingerprint === 'string') {
          senderPeer.publicKeyJwk = msg.publicKeyJwk as JsonWebKey;
          senderPeer.fingerprint = msg.fingerprint;
        }
        broadcastDirectory();
        return;
      }

      if (type === 'peer:lookup') {
        const targetDeskId = String(msg.targetDeskId || '').replace(/\D/g, '').slice(0, 9);
        const target = peers.get(targetDeskId);
        sendJson(ws, {
          type: 'peer:lookup_result',
          targetDeskId,
          online: Boolean(target),
          peer: target
            ? {
                deskId: target.deskId,
                alias: target.alias,
                platform: target.platform,
                fingerprint: target.fingerprint,
                publicKeyJwk: target.publicKeyJwk,
                unattendedEnabled: target.unattendedEnabled,
                hosting: target.hosting,
                monitorsCount: target.monitorsCount,
                connectedAt: target.connectedAt,
              }
            : null,
        });
        return;
      }

      if (type === 'session:request') {
        const targetDeskId = String(msg.targetDeskId || '').replace(/\D/g, '').slice(0, 9);
        const passcodeHash = String(msg.passcodeHash || '');
        const sessionId = String(msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

        if (!targetDeskId) {
          sendJson(ws, { type: 'session:error', message: 'Invalid target Desk ID.' });
          return;
        }

        if (targetDeskId === senderDeskId) {
          sendJson(ws, {
            type: 'session:error',
            message: 'You cannot connect a Desk ID to itself in the same tab. Open a second tab or scan the QR code from another device.',
          });
          return;
        }

        const targetPeer = peers.get(targetDeskId);
        if (!targetPeer) {
          sendJson(ws, {
            type: 'session:error',
            message: `Desk ${targetDeskId} is offline or unreachable.`,
          });
          return;
        }

        const unattendedValid =
          targetPeer.unattendedEnabled &&
          Boolean(targetPeer.unattendedHash) &&
          passcodeHash === targetPeer.unattendedHash;

        sessions.set(sessionId, {
          sessionId,
          viewerDeskId: senderDeskId,
          hostDeskId: targetDeskId,
          createdAt: Date.now(),
        });

        sendJson(targetPeer.ws, {
          type: 'session:incoming',
          sessionId,
          fromDeskId: senderPeer.deskId,
          fromAlias: senderPeer.alias,
          fromPlatform: senderPeer.platform,
          fromPublicKeyJwk: senderPeer.publicKeyJwk,
          fromFingerprint: senderPeer.fingerprint,
          autoAccepted: unattendedValid,
        });

        sendJson(ws, {
          type: 'session:requested',
          sessionId,
          targetDeskId: targetPeer.deskId,
          targetAlias: targetPeer.alias,
          targetPlatform: targetPeer.platform,
          targetPublicKeyJwk: targetPeer.publicKeyJwk,
          targetFingerprint: targetPeer.fingerprint,
          autoAccepted: unattendedValid,
        });
        return;
      }

      if (type === 'session:response') {
        const sessionId = String(msg.sessionId || '');
        const accepted = Boolean(msg.accepted);
        const permissions = msg.permissions as SessionPermissions | undefined;
        const reason = String(msg.reason || 'Connection declined by remote user.');

        const session = sessions.get(sessionId);
        if (!session) return;

        const viewerPeer = peers.get(session.viewerDeskId);
        if (!accepted) {
          sessions.delete(sessionId);
          sendJson(viewerPeer?.ws, {
            type: 'session:rejected',
            sessionId,
            reason,
          });
          return;
        }

        sendJson(viewerPeer?.ws, {
          type: 'session:accepted',
          sessionId,
          permissions,
          hostDeskId: senderPeer.deskId,
          hostAlias: senderPeer.alias,
          hostPlatform: senderPeer.platform,
          hostPublicKeyJwk: senderPeer.publicKeyJwk,
          hostFingerprint: senderPeer.fingerprint,
        });
        return;
      }

      if (type === 'session:end') {
        const sessionId = String(msg.sessionId || '');
        const session = sessions.get(sessionId);
        if (!session) return;

        const otherDeskId =
          session.viewerDeskId === senderDeskId ? session.hostDeskId : session.viewerDeskId;
        const otherPeer = peers.get(otherDeskId);
        sendJson(otherPeer?.ws, {
          type: 'session:ended',
          sessionId,
          reason: String(msg.reason || 'Session ended by peer'),
        });
        sessions.delete(sessionId);
        return;
      }

      if (type === 'rtc:signal' || type === 'relay:message') {
        const sessionId = String(msg.sessionId || '');
        const session = sessions.get(sessionId);
        if (!session) return;

        const targetDeskId =
          session.viewerDeskId === senderDeskId ? session.hostDeskId : session.viewerDeskId;
        const targetPeer = peers.get(targetDeskId);
        if (!targetPeer) return;

        sendJson(targetPeer.ws, {
          ...msg,
          fromDeskId: senderDeskId,
        });
        return;
      }
    });

    ws.on('close', () => {
      cleanupPeer(ws);
    });

    ws.on('error', () => {
      cleanupPeer(ws);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenDesk signaling & web server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OpenDesk server:', err);
  process.exit(1);
});
