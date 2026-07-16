import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "Private Garmin Trainer",
  description: "Local private AI trainer grounded in normalized Garmin data",
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
