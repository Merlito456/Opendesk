// Cloudflare Worker + Durable Object WebSocket Signaling & E2E Relay for OpenDesk
// Deploy with: npx wrangler deploy -c cloudflare/wrangler.toml

export interface Env {
  SIGNALING_ROOM: DurableObjectNamespace;
}

interface PeerAttachment {
  deskId: string;
  alias: string;
  platform: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  discoverable: boolean;
  unattendedEnabled: boolean;
  unattendedHash: string;
  hosting: boolean;
  monitorsCount: number;
  connectedAt: number;
}

interface ActiveSessionRecord {
  sessionId: string;
  viewerDeskId: string;
  hostDeskId: string;
  createdAt: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', edge: 'cloudflare-worker' }), {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('OpenDesk Cloudflare WebSocket Signaling Relay', {
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    const roomName = url.searchParams.get('room') || 'global';
    const id = env.SIGNALING_ROOM.idFromName(roomName);
    const stub = env.SIGNALING_ROOM.get(id);
    return stub.fetch(request);
  },
};

export class SignalingRoom {
  private state: DurableObjectState;
  private sessions = new Map<string, ActiveSessionRecord>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendJson(ws: WebSocket | undefined, payload: Record<string, unknown>) {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // socket closed
    }
  }

  private getConnectedPeers(): { ws: WebSocket; meta: PeerAttachment }[] {
    const list: { ws: WebSocket; meta: PeerAttachment }[] = [];
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as PeerAttachment | null;
      if (meta && meta.deskId) {
        list.push({ ws, meta });
      }
    }
    return list;
  }

  private findPeerByDeskId(deskId: string): { ws: WebSocket; meta: PeerAttachment } | undefined {
    return this.getConnectedPeers().find((p) => p.meta.deskId === deskId);
  }

  private getPublicDirectory() {
    return this.getConnectedPeers()
      .filter((p) => p.meta.discoverable)
      .map((p) => ({
        deskId: p.meta.deskId,
        alias: p.meta.alias,
        platform: p.meta.platform,
        fingerprint: p.meta.fingerprint,
        publicKeyJwk: p.meta.publicKeyJwk,
        unattendedEnabled: p.meta.unattendedEnabled,
        hosting: p.meta.hosting,
        monitorsCount: p.meta.monitorsCount,
        connectedAt: p.meta.connectedAt,
      }))
      .sort((a, b) => b.connectedAt - a.connectedAt);
  }

  private broadcastDirectory() {
    const directory = this.getPublicDirectory();
    for (const { ws } of this.getConnectedPeers()) {
      this.sendJson(ws, {
        type: 'directory:update',
        peers: directory,
      });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let msg: Record<string, unknown>;
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(msg.type || '');

    if (type === 'peer:register') {
      const deskId = String(msg.deskId || '').replace(/\D/g, '').slice(0, 9);
      if (!deskId) return;

      const existing = this.findPeerByDeskId(deskId);
      if (existing && existing.ws !== ws) {
        this.sendJson(existing.ws, {
          type: 'peer:superseded',
          reason: 'Connected from another window with the same Desk ID',
        });
        existing.ws.serializeAttachment(null);
      }

      const attachment: PeerAttachment = {
        deskId,
        alias: String(msg.alias || 'Workstation').slice(0, 64),
        platform: String(msg.platform || 'Linux'),
        publicKeyJwk: (msg.publicKeyJwk as JsonWebKey) || {},
        fingerprint: String(msg.fingerprint || ''),
        discoverable: msg.discoverable !== false,
        unattendedEnabled: Boolean(msg.unattendedEnabled),
        unattendedHash: String(msg.unattendedHash || ''),
        hosting: Boolean(msg.hosting),
        monitorsCount: Number(msg.monitorsCount || 1),
        connectedAt: Date.now(),
      };

      ws.serializeAttachment(attachment);
      this.sendJson(ws, {
        type: 'peer:registered',
        deskId,
        peers: this.getPublicDirectory(),
      });
      this.broadcastDirectory();
      return;
    }

    const senderMeta = ws.deserializeAttachment() as PeerAttachment | null;
    if (!senderMeta || !senderMeta.deskId) return;
    const senderDeskId = senderMeta.deskId;

    if (type === 'peer:update') {
      const next: PeerAttachment = {
        ...senderMeta,
        alias: typeof msg.alias === 'string' ? msg.alias.slice(0, 64) : senderMeta.alias,
        discoverable:
          typeof msg.discoverable === 'boolean' ? msg.discoverable : senderMeta.discoverable,
        unattendedEnabled:
          typeof msg.unattendedEnabled === 'boolean'
            ? msg.unattendedEnabled
            : senderMeta.unattendedEnabled,
        unattendedHash:
          typeof msg.unattendedHash === 'string' ? msg.unattendedHash : senderMeta.unattendedHash,
        hosting: typeof msg.hosting === 'boolean' ? msg.hosting : senderMeta.hosting,
        monitorsCount:
          typeof msg.monitorsCount === 'number' ? msg.monitorsCount : senderMeta.monitorsCount,
        publicKeyJwk: msg.publicKeyJwk ? (msg.publicKeyJwk as JsonWebKey) : senderMeta.publicKeyJwk,
        fingerprint: typeof msg.fingerprint === 'string' ? msg.fingerprint : senderMeta.fingerprint,
      };
      ws.serializeAttachment(next);
      this.broadcastDirectory();
      return;
    }

    if (type === 'session:request') {
      const targetDeskId = String(msg.targetDeskId || '').replace(/\D/g, '').slice(0, 9);
      const passcodeHash = String(msg.passcodeHash || '');
      const sessionId = String(
        msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      );

      if (!targetDeskId) {
        this.sendJson(ws, { type: 'session:error', message: 'Invalid target Desk ID.' });
        return;
      }
      if (targetDeskId === senderDeskId) {
        this.sendJson(ws, {
          type: 'session:error',
          message: 'You cannot connect a Desk ID to itself in the same tab.',
        });
        return;
      }

      const target = this.findPeerByDeskId(targetDeskId);
      if (!target) {
        this.sendJson(ws, {
          type: 'session:error',
          message: `Desk ${targetDeskId} is offline or unreachable.`,
        });
        return;
      }

      const unattendedValid =
        target.meta.unattendedEnabled &&
        Boolean(target.meta.unattendedHash) &&
        passcodeHash === target.meta.unattendedHash;

      this.sessions.set(sessionId, {
        sessionId,
        viewerDeskId: senderDeskId,
        hostDeskId: targetDeskId,
        createdAt: Date.now(),
      });

      this.sendJson(target.ws, {
        type: 'session:incoming',
        sessionId,
        fromDeskId: senderMeta.deskId,
        fromAlias: senderMeta.alias,
        fromPlatform: senderMeta.platform,
        fromPublicKeyJwk: senderMeta.publicKeyJwk,
        fromFingerprint: senderMeta.fingerprint,
        autoAccepted: unattendedValid,
      });

      this.sendJson(ws, {
        type: 'session:requested',
        sessionId,
        targetDeskId: target.meta.deskId,
        targetAlias: target.meta.alias,
        targetPlatform: target.meta.platform,
        targetPublicKeyJwk: target.meta.publicKeyJwk,
        targetFingerprint: target.meta.fingerprint,
        autoAccepted: unattendedValid,
      });
      return;
    }

    if (type === 'session:response') {
      const sessionId = String(msg.sessionId || '');
      const accepted = Boolean(msg.accepted);
      const session = this.sessions.get(sessionId);
      if (!session) return;

      const viewer = this.findPeerByDeskId(session.viewerDeskId);
      if (!accepted) {
        this.sessions.delete(sessionId);
        this.sendJson(viewer?.ws, {
          type: 'session:rejected',
          sessionId,
          reason: String(msg.reason || 'Connection declined by remote user.'),
        });
        return;
      }

      this.sendJson(viewer?.ws, {
        type: 'session:accepted',
        sessionId,
        permissions: msg.permissions,
        hostDeskId: senderMeta.deskId,
        hostAlias: senderMeta.alias,
        hostPlatform: senderMeta.platform,
        hostPublicKeyJwk: senderMeta.publicKeyJwk,
        hostFingerprint: senderMeta.fingerprint,
      });
      return;
    }

    if (type === 'session:end') {
      const sessionId = String(msg.sessionId || '');
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const otherId =
        session.viewerDeskId === senderDeskId ? session.hostDeskId : session.viewerDeskId;
      const other = this.findPeerByDeskId(otherId);
      this.sendJson(other?.ws, {
        type: 'session:ended',
        sessionId,
        reason: String(msg.reason || 'Session ended by peer'),
      });
      this.sessions.delete(sessionId);
      return;
    }

    if (type === 'rtc:signal' || type === 'relay:message') {
      const sessionId = String(msg.sessionId || '');
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const otherId =
        session.viewerDeskId === senderDeskId ? session.hostDeskId : session.viewerDeskId;
      const other = this.findPeerByDeskId(otherId);
      if (!other) return;
      this.sendJson(other.ws, {
        ...msg,
        fromDeskId: senderDeskId,
      });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as PeerAttachment | null;
    if (!meta || !meta.deskId) return;
    const deskId = meta.deskId;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.viewerDeskId === deskId || session.hostDeskId === deskId) {
        const otherId = session.viewerDeskId === deskId ? session.hostDeskId : session.viewerDeskId;
        const other = this.findPeerByDeskId(otherId);
        this.sendJson(other?.ws, {
          type: 'session:ended',
          sessionId,
          reason: 'Remote peer disconnected',
        });
        this.sessions.delete(sessionId);
      }
    }

    ws.serializeAttachment(null);
    this.broadcastDirectory();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}
