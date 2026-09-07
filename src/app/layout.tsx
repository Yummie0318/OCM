import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "One Control Map",
  description: "Penro Cagayan A&D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
