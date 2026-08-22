import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'RiftDrift — Your commands, at hand',
  description: 'A neon command-line workspace with your command library always within reach.',
  openGraph: {
    title: 'RiftDrift — Your commands, at hand',
    description: 'A neon command-line workspace with your command library always within reach.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'RiftDrift — Your commands, at hand.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RiftDrift — Your commands, at hand',
    description: 'A neon command-line workspace with your command library always within reach.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
