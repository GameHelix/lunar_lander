import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * The tab icon, inline: a neon lander on the night background. Declaring it
 * here also stops the browser asking for a /favicon.ico that does not exist.
 */
const ICON = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
    "<rect width='64' height='64' rx='14' fill='#070610'/>" +
    "<path d='M28 39 L32 52 L36 39 Z' fill='#fb923c'/>" +
    "<g fill='none' stroke='#22d3ee' stroke-width='3.2' stroke-linejoin='round' stroke-linecap='round'>" +
    "<path d='M24 29 L21 21 L25 13 L39 13 L43 21 L40 29 Z'/>" +
    "<path d='M20 29 H44 V37 H20 Z'/>" +
    "<path d='M23 35 L14 50 M41 35 L50 50 M10 50 H18 M46 50 H54'/>" +
    "</g></svg>"
)}`;

export const metadata: Metadata = {
  title: "Lunar Lander — neon vector arcade",
  description:
    "The classic vector arcade game in neon, built with Next.js and TypeScript. Fight lunar gravity on a tank of fuel and touch down soft and upright on narrow pads for ×2, ×3 and ×5 scores, across seeded moonscapes that grow harder every level.",
  icons: { icon: ICON },
};

export const viewport: Viewport = {
  themeColor: "#070610",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
