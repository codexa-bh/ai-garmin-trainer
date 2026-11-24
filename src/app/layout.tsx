import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "AI Trainer for Garmin Connect",
  description: "Local private AI trainer grounded in normalized Garmin data",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
