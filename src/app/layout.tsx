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
  title: "Data Dog",
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
  // One CSS var per icon (mask URL); the <Icon> component references var(--i-<name>).
  const iconNames = [
    "calcualtedField", "clear", "dashboard", "dataWorkshop", "logout",
    "myDistrictSchools", "saveViewOrGroup", "savedItems", "showHideEmpty",
    "showHidePanel", "visualizer",
  ];
  const cssVars = {
    "--brand-logo-src": `url("${basePath}/SchoolDataDog.svg")`,
    ...Object.fromEntries(
      iconNames.map((n) => [`--i-${n}`, `url("${basePath}/icons/${n}.svg")`]),
    ),
  } as React.CSSProperties;

  return (
    <html
      lang="en"
      style={cssVars}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
