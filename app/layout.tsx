import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "序衡 APS · 车工排产第一版",
  description: "面向车工班组的Excel导入式有限产能排产系统",
  openGraph: {
    title: "序衡 APS · 车工排产第一版",
    description: "通过MES导出表格生成车工六日排产计划",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "序衡 APS · 车工排产第一版",
    description: "车工有限产能排产、每日派工与人工确认",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
