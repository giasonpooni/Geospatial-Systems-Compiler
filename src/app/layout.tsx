import type { Metadata, Viewport } from 'next';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

function configuredSite(): URL | undefined {
  const value = process.env.NOTATION_SITE_ORIGIN;
  if (!value) return undefined;
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('NOTATION_SITE_ORIGIN must be an explicit HTTPS origin (loopback HTTP is allowed for development)');
  return url;
}
const site = configuredSite();
const description = 'Visualization, recorded-value comparison and evidence inspection for physical systems. Geographic views connect to exact records; existing freight and commodity applications remain available.';
export const viewport: Viewport = { themeColor: '#09121e', width: 'device-width', initialScale: 1, maximumScale: 5, colorScheme: 'dark' };
export const metadata: Metadata = {
  ...(site ? { metadataBase: site } : {}),
  title: { default: 'Notation Systems | Geospatial Systems Compiler', template: '%s' },
  description, creator: 'Notation Systems', publisher: 'Notation Systems',
  keywords: ['scientific visualization', 'geographic inspection', 'data provenance', 'record comparison', 'computational instrumentation', 'Payload Terminal', 'Notation Systems'],
  openGraph: { title: 'Notation Systems | Geospatial Systems Compiler', description, type: 'website', siteName: 'Notation Systems' },
  twitter: { card: 'summary', title: 'Notation Systems', description },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  category: 'technology',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" dir="ltr"><body className="antialiased"><ErrorBoundary name="Notation Systems">{children}</ErrorBoundary></body></html>;
}
