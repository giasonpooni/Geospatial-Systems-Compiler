import type { Metadata, Viewport } from 'next';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';
export const viewport: Viewport = { themeColor: '#080e19', width: 'device-width', initialScale: 1, maximumScale: 5, colorScheme: 'dark' };
export const metadata: Metadata = {
  title: { default: 'Geospatial Systems Compiler — Notation Systems', template: '%s | Notation Systems' },
  description: 'Inspect source-bound physical-system records through synchronized maps, globes, tables and timelines. Includes an explicitly synthetic geographic demonstration and the existing physical-economy terminal.',
  applicationName: 'Geospatial Systems Compiler',
  creator: 'Notation Systems', publisher: 'Notation Systems',
  icons: { icon: '/favicon.ico' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="antialiased"><ErrorBoundary name="Geospatial Systems Compiler">{children}</ErrorBoundary></body></html>;
}
