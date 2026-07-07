import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "School Data Dog",
  description: "Explore and compare New York State school & district data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Prefix static assets referenced from CSS with basePath (Next doesn't rewrite
  // url() in stylesheets). Empty in dev, "/schooldatadog" behind the proxy.
  const basePath = (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");
  const brandLogoVar = {
    "--brand-logo-src": `url("${basePath}/SchoolDataDog.svg")`,
  } as React.CSSProperties;

  return (
    <html
      lang="en"
      style={brandLogoVar}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
