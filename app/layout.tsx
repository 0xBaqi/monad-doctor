import type { Metadata } from 'next';
import './globals.css';
const title = 'Monad Doctor | Monad integration diagnostics';
const description = 'Find and fix Monad integration problems before they reach production. Read-only RPC, gas-limit and transaction lifecycle diagnostics with evidence and actionable fixes.';
export const metadata: Metadata = {
 metadataBase: new URL('https://monad-doctor.vercel.app'),
 title, description, applicationName: 'Monad Doctor',
 alternates: { canonical: '/' },
 icons: {
  icon: [
   { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
   { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
   { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  ],
  shortcut: '/favicon.ico',
  apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
 },
 openGraph: {
  type: 'website', locale: 'en_US', url: '/', siteName: 'Monad Doctor', title, description,
  images: [{ url: '/social-preview.png', width: 1200, height: 630, alt: 'Monad Doctor. Find and fix Monad integration problems. Evidence, fix, verify.' }],
 },
 twitter: { card: 'summary_large_image', title, description, images: [{ url: '/social-preview.png', alt: 'Monad Doctor. Find and fix Monad integration problems. Evidence, fix, verify.' }] },
};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
