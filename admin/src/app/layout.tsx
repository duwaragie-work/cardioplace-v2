import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/contexts/LanguageContext";
import AdminShell from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "Cardioplace Admin",
  description: "Cardioplace provider and care-team admin console",
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
            {/* AdminShell wraps authed pages with sidebar + top bar; landing
                / auth routes pass through unchanged so they keep their own
                marketing chrome. */}
            <AdminShell>{children}</AdminShell>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
