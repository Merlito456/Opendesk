import { Laptop, Monitor, Smartphone, Terminal } from 'lucide-react';
import type { PlatformOS } from '../types';

export function OpenDeskMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="24" height="24" rx="6" className="fill-red-600" />
      <path
        d="M9 9.5L14.5 14L9 18.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 9.5L13.5 14L19 18.5"
        stroke="white"
        strokeOpacity="0.72"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlatformIcon({
  platform,
  className = 'w-4 h-4',
}: {
  platform: PlatformOS;
  className?: string;
}) {
  switch (platform) {
    case 'Windows':
      return <Monitor className={className} />;
    case 'macOS':
      return <Laptop className={className} />;
    case 'Linux':
      return <Terminal className={className} />;
    case 'Android':
    case 'iOS':
      return <Smartphone className={className} />;
  }
}
