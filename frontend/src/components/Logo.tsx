import Image from "next/image";
import Link from "next/link";

// Combined Cardioplace wordmark — icon + "Cardioplace" baked into a single
// SVG. The 4.5:1 viewBox (288×64) means we set the height and let width
// flow with `w-auto` so the wordmark stays crisp at every breakpoint.
export default function Logo() {
  return (
    <Link href="/" className="flex items-center justify-center lg:justify-start">
      <Image
        src="/cardioplace-logo.svg"
        alt="Cardioplace"
        width={180}
        height={40}
        className="h-7 w-auto lg:h-9"
        priority
      />
    </Link>
  );
}
