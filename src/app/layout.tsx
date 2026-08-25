import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lot Data -> Shapefile / KML / GeoJSON",
  description: "Convert LMB Lot Data Computation Sheets into downloadable GIS files.",
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
