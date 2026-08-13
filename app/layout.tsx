import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "셔틀클럽 배드민턴 리그",
  description: "팀·코트·경기 결과와 실시간 순위를 관리하는 배드민턴 리그 운영 서비스입니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
