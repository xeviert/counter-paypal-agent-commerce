import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Counter ops", template: "%s · Counter ops" },
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: LayoutProps<"/ops">) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
