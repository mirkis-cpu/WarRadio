"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Clock,
  Library,
  Settings,
  Radio,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEngineStore } from "@/stores/engine-store";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timeline", label: "Timeline", icon: Clock },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const socketConnected = useEngineStore((s) => s.socketConnected);

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] bg-zinc-950 border-r border-zinc-800 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-zinc-800">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30">
          <Radio className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <div className="text-sm font-bold text-zinc-100 tracking-tight leading-none">
            RadioWar
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-widest">
            Control Room
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              data-testid={`nav-${label.toLowerCase()}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-violet-600/20 text-violet-300 border border-violet-500/20"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  isActive ? "text-violet-400" : "text-zinc-500"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Engine connection status */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          {socketConnected ? (
            <Wifi className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400 animate-pulse" />
          )}
          <span
            className={cn(
              "text-xs",
              socketConnected ? "text-green-400" : "text-red-400"
            )}
          >
            {socketConnected ? "Engine connected" : "Engine offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}
