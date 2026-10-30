import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { prisma } from "@/lib/prisma";
import { CurrencyProvider } from "@/lib/currency";
import RouteProgress from "@/components/RouteProgress";
import AnnouncementBar from "@/components/AnnouncementBar";

// Always render the desktop layout (even on phones): the browser lays the
// page out at 1280px wide and scales it down to fit the screen.
export const viewport: Viewport = {
  width: 1280,
};

export const metadata: Metadata = {
  title: "TRATOPUP — Fast & Secure Game Top Up",
  description:
    "Top up Mobile Legends, Free Fire, PUBG, Genshin Impact and more. Instant delivery, secure KHQR payment. 24/7 service in Cambodia.",
  keywords: [
    "top up",
    "mobile legends diamonds",
    "free fire diamonds",
    "pubg uc",
    "genshin impact",
    "ABA Pay",
    "KHQR",
    "Cambodia top up",
  ],
  openGraph: {
    title: "TRATOPUP — Fast & Secure Game Top Up",
    description: "Instant game top-ups with KHQR · ABA Pay · Wing · ACLEDA",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  const exchangeRate = settings?.exchangeRate ?? 4100;

  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        <CurrencyProvider exchangeRate={exchangeRate}>
          <AnnouncementBar />
          {children}
        </CurrencyProvider>
      </body>
    </html>
  );
}
