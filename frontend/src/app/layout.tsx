import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/contexts/LanguageContext";
import NavbarWrapper from "@/components/NavbarWrapper";
import ScrollToTop from "@/components/ScrollToTop";
import HardReloadOnNavigate from "@/components/HardReloadOnNavigate";
import PoweredByFooter from "@/components/PoweredByFooter";
import SkipLink from "@/components/SkipLink";
import IdleWarningToast from "@/components/auth/IdleWarningToast";
import PushRegistrar from "@/components/auth/PushRegistrar";
import RouteGuard from "@/components/auth/RouteGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cardioplace",
  description: "Cardiovascular patient monitoring and care coordination platform",
  // Web app manifest — required for "Add to Home Screen", which iOS Safari
  // requires before it will allow Web Push at all.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/cardioplace-icon.svg",
    apple: "/cardioplace-icon.svg",
  },
  // Marks the installed PWA as a standalone iOS web app (enables push on iOS).
  appleWebApp: {
    capable: true,
    title: "Cardioplace",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <LanguageProvider>
            <SkipLink />
            <ScrollToTop />
            <HardReloadOnNavigate />
            <IdleWarningToast />
            <PushRegistrar />
            <RouteGuard>
              <NavbarWrapper>{children}</NavbarWrapper>
            </RouteGuard>
            <PoweredByFooter />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
