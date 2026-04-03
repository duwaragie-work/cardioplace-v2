'use client';

import Link from 'next/link';
import Image from 'next/image';

interface LandingHeaderProps {
  activeLink?: string;
}

export default function LandingHeader({ activeLink = 'Home' }: LandingHeaderProps) {
  const links = [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 shadow-[0_1px_2px_rgba(76,29,149,0.05)]">
      <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 md:px-8 py-4">
        <Link href="/" className="flex items-center gap-1">
          <Image src="/logo.svg" alt="Healplace Cardio" width={42} height={42} />
          <span className="font-bold text-[#6b00d1] text-xl md:text-2xl tracking-tight">
            Healplace Cardio
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-10">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={
                activeLink === link.label
                  ? 'font-semibold text-[#6d28d9] text-base border-b-2 border-[#6d28d9] pb-0.5'
                  : 'text-[#475569] text-base hover:text-[#6d28d9] transition-colors'
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Link
          href="/welcome"
          className="bg-[#6b00d1] text-white font-semibold text-sm md:text-base px-5 md:px-6 py-2 rounded-full hover:bg-[#5a00b0] transition-colors"
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}
