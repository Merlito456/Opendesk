import type { PlatformOS } from '../types';

export function detectPlatform(): PlatformOS {
  if (typeof navigator === 'undefined') return 'Linux';
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  if (/iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && navigator.maxTouchPoints > 1)) {
    return 'iOS';
  }
  if (/android/.test(ua)) {
    return 'Android';
  }
  if (/win/.test(platform) || /windows/.test(ua)) {
    return 'Windows';
  }
  if (/mac/.test(platform) || /mac os/.test(ua)) {
    return 'macOS';
  }
  return 'Linux';
}

export function supportsDisplayCapture(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function')
  );
}

export function formatDeskId(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ');
}

export function normalizeDeskId(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 9);
}

export function generateDeskId(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = 100_000_000 + (arr[0] % 899_999_999);
  return String(num);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${sizes[i]}`;
}

export function formatSpeed(bps: number): string {
  if (bps <= 0) return '0 KB/s';
  return `${formatBytes(bps)}/s`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function defaultDeviceAlias(os: PlatformOS): string {
  return `My ${os} Workstation`;
}
