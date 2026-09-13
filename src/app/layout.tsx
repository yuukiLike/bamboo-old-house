import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '竹林里的老屋 · 四时竹声',
  icons: { icon: '/icon.svg' },
  description: '沿着小路走回家乡老屋，看清晨与傍晚的光，听夏蝉、晨鸟和竹叶风声。进屋环顾，在竹林里抬头望月，让这段空间记忆慢慢醒来。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
