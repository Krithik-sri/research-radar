"use client";

import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/papers", label: "Papers" },
  { href: "/graph", label: "Graph" },
  { href: "/admin", label: "Admin" },
];

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <nav className="nav">
      <span className="brand">📡 Research Radar</span>
      {NAV.map((n) => (
        <a key={n.href} href={n.href} className={`nav-link${isActive(n.href) ? " active" : ""}`}>
          {n.label}
        </a>
      ))}
      <a href="/api/logout" className="nav-link" style={{ marginLeft: "auto" }}>
        Log out
      </a>
    </nav>
  );
}
