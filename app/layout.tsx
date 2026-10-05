import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "3D print models",
  description: "Customize printable 3D models in the browser and download 3MF, STL, OBJ, or GLB.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <link
          rel="preload"
          href="/fonts/luckiest-guy.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
      </head>
      <body className="flex min-h-full flex-col bg-[#f4f5f7] text-zinc-900">
        {children}
        <footer className="mt-auto border-t border-[#e6e7ec] px-5 py-4 text-center text-xs text-zinc-500">
          Developer: John Paul Polendey
        </footer>
      </body>
    </html>
  );
}
