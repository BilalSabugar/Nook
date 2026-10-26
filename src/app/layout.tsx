import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Nook — Autonomous AI Coworkers with Persistent Computers & Spaces',
  description: 'An open-source workspace for persistent AI coworkers, each with its own sandboxed computer. Collaborate across documents, web browsing, shell execution, and human-in-the-loop review cards.',
  icons: {
    icon: '/favicon.ico',
  },
};

import { ToastProvider } from '@/components/ui/Toast';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[#0d0d0d] text-neutral-100 antialiased font-sans selection:bg-white/20 selection:text-white">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
