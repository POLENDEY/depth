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
      <body className="min-h-full bg-[#f4f5f7] text-zinc-900">{children}</body>
    </html>
  );
}
