"use client";

import { HomeIcon, InboxIcon, PackageIcon, PlusIcon, TagIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n/core";

const ITEMS: { href: string; label: MessageKey; icon: typeof HomeIcon }[] = [
  { href: "/s", label: "nav.home", icon: HomeIcon },
  { href: "/s/listings", label: "nav.listings", icon: TagIcon },
  { href: "/s/new", label: "nav.new", icon: PlusIcon },
  { href: "/s/orders", label: "nav.orders", icon: PackageIcon },
  { href: "/s/inbox", label: "nav.inbox", icon: InboxIcon },
];

export function BottomNav({ unread }: { unread: number }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/s" ? pathname === "/s" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground aria-[current=page]:text-foreground"
              >
                <Icon className="size-5" aria-hidden />
                {t(label)}
                {href === "/s/inbox" && unread > 0 && (
                  <span className="absolute top-1 right-[calc(50%-1.25rem)] min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
