import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "./providers/app-providers";

export const metadata: Metadata = {
  title: "BTC Yield Vault",
  description: "Earn gasless yield on Bitcoin on Starknet."
};

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-b from-black via-background-soft to-black">
        <AppProviders privyAppId={PRIVY_APP_ID}>{children}</AppProviders>
      </body>
    </html>
  );
}
