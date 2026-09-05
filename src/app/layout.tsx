import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Razorpay | AI Finance Controller & Reconciliation Agent",
  description: "Enterprise multi-source financial reconciliation, fuzzy matching & anomaly detection control center",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#F8FAFC] dark:bg-[#0A0D14] text-slate-900 dark:text-slate-100 antialiased selection:bg-[#0052FF]/20 selection:text-[#0052FF] transition-colors duration-150">
        {children}
      </body>
    </html>
  );
}
