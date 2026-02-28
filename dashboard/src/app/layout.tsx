import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/query-client";
import { Sidebar } from "@/components/layout/Sidebar";
import { NowPlayingBar } from "@/components/layout/NowPlayingBar";
import { SocketInitializer } from "@/components/layout/SocketInitializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RadioWar — Control Room",
  description: "AI-powered war news radio station dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        <QueryProvider>
          {/* Socket.io connection + Zustand store hydration */}
          <SocketInitializer />

          {/* Fixed sidebar */}
          <Sidebar />

          {/* Main content area - offset for sidebar & now-playing bar */}
          <main
            className="ml-[220px] mb-[72px] min-h-screen overflow-y-auto"
            id="main-content"
          >
            {children}
          </main>

          {/* Persistent bottom bar */}
          <NowPlayingBar />
        </QueryProvider>
      </body>
    </html>
  );
}
