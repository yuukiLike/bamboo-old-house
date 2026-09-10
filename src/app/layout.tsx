import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '竹林里的老屋 · 廊下望竹',
  icons: { icon: '/icon.svg' },
  description: '坐在家乡老屋的木廊，看日光与月色穿过竹林。屋里留着暖灯，屋外有星光与萤火，360° 环顾老屋，也沿小路走近这段空间记忆。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
