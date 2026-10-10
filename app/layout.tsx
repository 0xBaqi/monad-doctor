import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Monad Doctor · Integration diagnostics', description: 'Read-only Monad Mainnet diagnostics. Trace the evidence, understand gas limits, and verify transaction finality.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
