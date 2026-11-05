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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('mash_theme_settings');var m=s?JSON.parse(s).mode:'dark';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d){r.classList.add('dark');r.setAttribute('data-theme','dark');}else{r.classList.remove('dark');r.setAttribute('data-theme','light');}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
