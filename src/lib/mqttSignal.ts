import mqtt, { type MqttClient } from 'mqtt';
import type { PeerDirectoryEntry, PlatformOS } from '../types';

export const FREE_PUBLIC_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
] as const;

export interface MqttPeerConfig {
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
  room?: string;
}

export interface MqttRelayCallbacks {
  onConnect: (brokerUrl: string) => void;
  onDisconnect: () => void;
  onSignalMessage: (msg: Record<string, unknown>) => void | Promise<void>;
}

export class FreeCloudRelayClient {
  private client: MqttClient | null = null;
  private config: MqttPeerConfig;
  private callbacks: MqttRelayCallbacks;
  private room: string;
  private brokerIndex = 0;
  private peers = new Map<string, PeerDirectoryEntry & { _seenAt: number }>();
  private sessionTargetMap = new Map<string, string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(config: MqttPeerConfig, callbacks: MqttRelayCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.room = (config.room || 'opendesk-public-v1').replace(/[^a-zA-Z0-9_-]/g, '');
  }

  private get baseTopic() {
    return `opendesk/${this.room}`;
  }

  connect() {
    if (this.closed) return;
    const brokerUrl = FREE_PUBLIC_BROKERS[this.brokerIndex % FREE_PUBLIC_BROKERS.length];

    const presenceTopic = `${this.baseTopic}/presence/${this.config.deskId}`;
    const inboxTopic = `${this.baseTopic}/inbox/${this.config.deskId}`;
    const pingTopic = `${this.baseTopic}/ping`;
    const wildcardPresence = `${this.baseTopic}/presence/+`;

    const client = mqtt.connect(brokerUrl, {
      clientId: `od_${this.config.deskId}_${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      connectTimeout: 6000,
      reconnectPeriod: 4000,
      keepalive: 25,
      will: {
        topic: presenceTopic,
        payload: JSON.stringify({ offline: true, deskId: this.config.deskId }),
        qos: 0,
        retain: false,
      },
    });

    this.client = client;
    let connectedOnce = false;

    const failover = () => {
      if (connectedOnce || this.closed || this.client !== client) return;
      this.brokerIndex = (this.brokerIndex + 1) % FREE_PUBLIC_BROKERS.length;
      try {
        client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
      globalThis.setTimeout(() => this.connect(), 250);
    };

    const connectGuardTimer = globalThis.setTimeout(() => {
      if (!connectedOnce && !this.closed) {
        failover();
      }
    }, 6500);

    client.on('connect', () => {
      connectedOnce = true;
      globalThis.clearTimeout(connectGuardTimer);
      if (this.closed) {
        client.end(true);
        return;
      }

      client.subscribe([wildcardPresence, inboxTopic, pingTopic], { qos: 0 }, () => {
        this.publishPresence();
        client.publish(pingTopic, JSON.stringify({ deskId: this.config.deskId }));
        this.callbacks.onConnect(brokerUrl);
      });

      if (this.heartbeatTimer) globalThis.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = globalThis.setInterval(() => {
        this.publishPresence();
      }, 15000);

      if (this.pruneTimer) globalThis.clearInterval(this.pruneTimer);
      this.pruneTimer = globalThis.setInterval(() => {
        const cutoff = Date.now() - 38000;
        let changed = false;
        for (const [id, entry] of this.peers.entries()) {
          if (entry._seenAt < cutoff) {
            this.peers.delete(id);
            changed = true;
          }
        }
        if (changed) this.emitDirectory();
      }, 8000);
    });

    client.on('error', () => {
      if (!connectedOnce && !this.closed) {
        globalThis.clearTimeout(connectGuardTimer);
        failover();
      }
    });

    client.on('close', () => {
      globalThis.clearTimeout(connectGuardTimer);
      if (!this.closed && connectedOnce) {
        this.callbacks.onDisconnect();
      }
    });

    client.on('message', async (topic, payloadBuf) => {
      if (this.closed) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(payloadBuf.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (topic === pingTopic) {
        if (data.deskId !== this.config.deskId) {
          this.publishPresence();
        }
        return;
      }

      if (topic.startsWith(`${this.baseTopic}/presence/`)) {
        if (data.offline && typeof data.deskId === 'string') {
          if (this.peers.delete(data.deskId)) {
            this.emitDirectory();
          }
          return;
        }
        const peer = data.peer as PeerDirectoryEntry | undefined;
        if (peer && peer.deskId && peer.deskId !== this.config.deskId) {
          this.peers.set(peer.deskId, { ...peer, _seenAt: Date.now() });
          this.emitDirectory();
        }
        return;
      }

      if (topic === inboxTopic) {
        const type = String(data.type || '');

        if (type === 'session:request') {
          const fromDeskId = String(data.fromDeskId || '');
          const sessionId = String(data.sessionId || '');
          if (fromDeskId && sessionId) {
            this.sessionTargetMap.set(sessionId, fromDeskId);
          }

          const passcodeHash = String(data.passcodeHash || '');
          const autoAccepted =
            this.config.unattendedEnabled &&
            Boolean(this.config.unattendedHash) &&
            passcodeHash === this.config.unattendedHash;

          await this.callbacks.onSignalMessage({
            type: 'session:incoming',
            sessionId,
            fromDeskId,
            fromAlias: data.fromAlias,
            fromPlatform: data.fromPlatform,
            fromPublicKeyJwk: data.fromPublicKeyJwk,
            fromFingerprint: data.fromFingerprint,
            autoAccepted,
          });
          return;
        }

        if (type === 'session:response') {
          const sessionId = String(data.sessionId || '');
          const accepted = Boolean(data.accepted);
          if (!accepted) {
            this.sessionTargetMap.delete(sessionId);
            await this.callbacks.onSignalMessage({
              type: 'session:rejected',
              sessionId,
              reason: data.reason,
            });
          } else {
            await this.callbacks.onSignalMessage({
              type: 'session:accepted',
              sessionId,
              permissions: data.permissions,
              hostDeskId: data.hostDeskId,
              hostAlias: data.hostAlias,
              hostPlatform: data.hostPlatform,
              hostPublicKeyJwk: data.hostPublicKeyJwk,
              hostFingerprint: data.hostFingerprint,
            });
          }
          return;
        }

        if (type === 'session:end') {
          const sessionId = String(data.sessionId || '');
          this.sessionTargetMap.delete(sessionId);
          await this.callbacks.onSignalMessage({
            type: 'session:ended',
            sessionId,
            reason: data.reason,
          });
          return;
        }

        if (type === 'rtc:signal' || type === 'relay:message') {
          await this.callbacks.onSignalMessage(data);
        }
      }
    });
  }

  updateConfig(partial: Partial<MqttPeerConfig>) {
    this.config = { ...this.config, ...partial };
    this.publishPresence();
  }

  private publishPresence() {
    if (!this.client || !this.client.connected || this.closed) return;
    const presenceTopic = `${this.baseTopic}/presence/${this.config.deskId}`;
    if (!this.config.discoverable) {
      this.client.publish(
        presenceTopic,
        JSON.stringify({ offline: true, deskId: this.config.deskId })
      );
      return;
    }

    const peer: PeerDirectoryEntry = {
      deskId: this.config.deskId,
      alias: this.config.alias,
      platform: this.config.platform,
      fingerprint: this.config.fingerprint,
      publicKeyJwk: this.config.publicKeyJwk,
      unattendedEnabled: this.config.unattendedEnabled,
      hosting: this.config.hosting,
      monitorsCount: this.config.monitorsCount,
      connectedAt: Date.now(),
    };
    this.client.publish(presenceTopic, JSON.stringify({ peer }));
  }

  private emitDirectory() {
    const list = Array.from(this.peers.values())
      .map(({ _seenAt: _ignored, ...peer }) => peer)
      .sort((a, b) => b.connectedAt - a.connectedAt);

    this.callbacks.onSignalMessage({
      type: 'directory:update',
      peers: list,
    });
  }

  sendOutbound(payload: Record<string, unknown>) {
    if (!this.client || !this.client.connected || this.closed) return false;
    const type = String(payload.type || '');

    if (type === 'peer:update') {
      this.updateConfig({
        alias: typeof payload.alias === 'string' ? payload.alias : this.config.alias,
        discoverable:
          typeof payload.discoverable === 'boolean'
            ? payload.discoverable
            : this.config.discoverable,
        unattendedEnabled:
          typeof payload.unattendedEnabled === 'boolean'
            ? payload.unattendedEnabled
            : this.config.unattendedEnabled,
        unattendedHash:
          typeof payload.unattendedHash === 'string'
            ? payload.unattendedHash
            : this.config.unattendedHash,
        hosting: typeof payload.hosting === 'boolean' ? payload.hosting : this.config.hosting,
        monitorsCount:
          typeof payload.monitorsCount === 'number'
            ? payload.monitorsCount
            : this.config.monitorsCount,
        publicKeyJwk: (payload.publicKeyJwk as JsonWebKey) || this.config.publicKeyJwk,
        fingerprint:
          typeof payload.fingerprint === 'string'
            ? payload.fingerprint
            : this.config.fingerprint,
      });
      return true;
    }

    if (type === 'session:request') {
      const targetDeskId = String(payload.targetDeskId || '').replace(/\D/g, '').slice(0, 9);
      const sessionId = String(payload.sessionId || '');
      if (!targetDeskId || !sessionId) return false;

      if (targetDeskId === this.config.deskId) {
        this.callbacks.onSignalMessage({
          type: 'session:error',
          message:
            'You cannot connect a Desk ID to itself in the same tab. Open a second tab or scan the QR code from another device.',
        });
        return true;
      }

      const targetPeer = this.peers.get(targetDeskId);
      if (!targetPeer) {
        this.callbacks.onSignalMessage({
          type: 'session:error',
          message: `Desk ${targetDeskId} is offline or not in this relay room (${this.room}).`,
        });
        return true;
      }

      this.sessionTargetMap.set(sessionId, targetDeskId);
      this.client.publish(
        `${this.baseTopic}/inbox/${targetDeskId}`,
        JSON.stringify({
          type: 'session:request',
          sessionId,
          passcodeHash: payload.passcodeHash || '',
          fromDeskId: this.config.deskId,
          fromAlias: this.config.alias,
          fromPlatform: this.config.platform,
          fromPublicKeyJwk: this.config.publicKeyJwk,
          fromFingerprint: this.config.fingerprint,
        })
      );

      this.callbacks.onSignalMessage({
        type: 'session:requested',
        sessionId,
        targetDeskId: targetPeer.deskId,
        targetAlias: targetPeer.alias,
        targetPlatform: targetPeer.platform,
        targetPublicKeyJwk: targetPeer.publicKeyJwk,
        targetFingerprint: targetPeer.fingerprint,
      });
      return true;
    }

    const sessionId = String(payload.sessionId || '');
    const targetDeskId = this.sessionTargetMap.get(sessionId);
    if (!targetDeskId) return false;

    if (type === 'session:response') {
      this.client.publish(
        `${this.baseTopic}/inbox/${targetDeskId}`,
        JSON.stringify({
          ...payload,
          hostDeskId: this.config.deskId,
          hostAlias: this.config.alias,
          hostPlatform: this.config.platform,
          hostPublicKeyJwk: this.config.publicKeyJwk,
          hostFingerprint: this.config.fingerprint,
        })
      );
      if (!payload.accepted) {
        this.sessionTargetMap.delete(sessionId);
      }
      return true;
    }

    if (type === 'session:end') {
      this.client.publish(`${this.baseTopic}/inbox/${targetDeskId}`, JSON.stringify(payload));
      this.sessionTargetMap.delete(sessionId);
      return true;
    }

    if (type === 'rtc:signal' || type === 'relay:message') {
      this.client.publish(
        `${this.baseTopic}/inbox/${targetDeskId}`,
        JSON.stringify({
          ...payload,
          fromDeskId: this.config.deskId,
        })
      );
      return true;
    }

    return false;
  }

  disconnect() {
    this.closed = true;
    if (this.heartbeatTimer) globalThis.clearInterval(this.heartbeatTimer);
    if (this.pruneTimer) globalThis.clearInterval(this.pruneTimer);
    if (this.client) {
      try {
        if (this.client.connected) {
          this.client.publish(
            `${this.baseTopic}/presence/${this.config.deskId}`,
            JSON.stringify({ offline: true, deskId: this.config.deskId })
          );
        }
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
    }
  }
}
