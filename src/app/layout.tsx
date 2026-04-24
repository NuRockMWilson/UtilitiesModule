import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NuRock Utilities AP",
  description: "Utility AP automation — intake, coding, approval, Sage posting, tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
