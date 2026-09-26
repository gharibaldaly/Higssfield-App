import {
  ChartPie,
  Clapperboard,
  FlaskConical,
  Ghost,
  Images,
  LayoutDashboard,
  LayoutGrid,
  Mic,
  Palette,
  Settings,
  Shirt,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  /** Key in messages `nav.*`. */
  key: "studio" | "products" | "ghost" | "ads" | "library" | "settings";
  icon: LucideIcon;
};

export type SoonItem = {
  key: "ugc" | "fragrance" | "social" | "brandKit" | "costs";
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "studio", icon: LayoutDashboard },
  { href: "/products", key: "products", icon: Shirt },
  { href: "/ghost", key: "ghost", icon: Ghost },
  { href: "/ads", key: "ads", icon: Clapperboard },
  { href: "/library", key: "library", icon: Images },
  { href: "/settings", key: "settings", icon: Settings },
];

/** Coming soon (Phase 3) — shown disabled in the navigation. */
export const SOON_ITEMS: SoonItem[] = [
  { key: "ugc", icon: Mic },
  { key: "fragrance", icon: FlaskConical },
  { key: "social", icon: LayoutGrid },
  { key: "brandKit", icon: Palette },
  { key: "costs", icon: ChartPie },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
