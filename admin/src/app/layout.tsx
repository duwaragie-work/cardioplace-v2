import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/contexts/LanguageContext";
import AdminShell from "@/components/AdminShell";
import SkipLink from "@/components/SkipLink";
import IdleWarningToast from "@/components/auth/IdleWarningToast";

export const metadata: Metadata = {
  title: "Cardioplace Admin",
  description: "Cardioplace provider and care-team admin console",
  icons: {
    icon: "/cardioplace-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-screen">
        <AuthProvider>
          <LanguageProvider>
            <SkipLink />
            <IdleWarningToast />
            {/* AdminShell wraps authed pages with sidebar + top bar; landing
                / auth routes pass through unchanged so they keep their own
                marketing chrome. */}
            <AdminShell>{children}</AdminShell>
            <Toaster
              position="top-right"
              richColors
              closeButton
              expand
              toastOptions={{
                style: {
                  fontFamily: 'inherit',
                  fontSize: '13px',
                  fontWeight: 600,
                },
              }}
            />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
