import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/notifications/Toaster";

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
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}