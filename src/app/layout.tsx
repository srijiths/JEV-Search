import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JEV Search — one box, every real estate search",
  description:
    "A search box that morphs into the right form as you type, classified live by Jev and parsed deterministically into a structured query.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
