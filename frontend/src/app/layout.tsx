import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MASH",
  description: "MASH Workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
