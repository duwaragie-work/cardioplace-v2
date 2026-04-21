import Image from "next/image";
import Link from "next/link";

export default function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 justify-center lg:justify-start">
      <Image
        src="/logo.svg"
        alt="Cardioplace logo"
        width={40}
        height={40}
        className="h-10 w-10 lg:h-12 lg:w-12"
        priority
      />
      <span
        className="font-bold text-xl lg:text-2xl"
        style={{ color: 'var(--brand-primary-purple)' }}
      >
        Cardioplace
      </span>
    </Link>
  );
}
