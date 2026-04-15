'use client';

import { usePathname } from 'next/navigation';

const SHOW_PATHS = ['/', '/home', '/about', '/onboarding'];

export default function PoweredByFooter() {
  const pathname = usePathname();
  if (!SHOW_PATHS.includes(pathname ?? '')) return null;

  return (
    <footer className="w-full py-3 text-center text-sm font-medium text-white" style={{ backgroundColor: '#7b00e0' }}>
      <a
        href="https://healplace.com"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline hover:text-gray-200 transition-colors"
      >
        A Healplace Company
      </a>
    </footer>
  );
}
