import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '四时竹声',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
  description: '长大才知晓，外婆家的竹林，就是世外桃源。在四时竹声里，看晨昏流转，听风过竹梢、雨落屋檐。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
