import Link from "next/link";

export default function Footer() {
  return (
    <footer className="relative border-t border-fox-border/40 bg-fox-surface/40">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src="/logo.png" alt="LayzzStore" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
              <span className="font-display text-lg font-bold">
                Layzz<span className="text-fox-primary">Store</span>
              </span>
            </div>
            <p className="text-xs text-fox-muted leading-relaxed">
              Cambodia&apos;s fastest game top-up. Instant delivery, secure payment.
            </p>
          </div>

          {/* Links */}
          {[
            {
              heading: "Quick Links",
              items: [
                { label: "Home", href: "/" },
                { label: "All Games", href: "/#games" },
                { label: "Track Order", href: "/order" },
                { label: "FAQ", href: "/faq" },
                { label: "Blog", href: "/blog" },
              ],
            },
            {
              heading: "Payment",
              items: [
                { label: "KHQR", href: "#" },
                { label: "ABA Pay", href: "#" },
                { label: "Wing", href: "#" },
              ],
            },
            {
              heading: "Support",
              items: [
                { label: "Telegram: @Tradev14", href: "https://t.me/Tradev14" },
                { label: "24/7 Service", href: "#" },
              ],
            },
          ].map((col) => (
            <div key={col.heading}>
              <h4 className="font-semibold mb-3 text-xs uppercase tracking-wider text-fox-muted">{col.heading}</h4>
              <ul className="space-y-1.5 text-sm">
                {col.items.map((it) => (
                  <li key={it.label}>
                    <Link href={it.href} className="text-fox-text/70 transition-colors hover:text-fox-primary text-xs">
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-fox-border/40 flex flex-col sm:flex-row justify-between items-center gap-3 text-[11px] text-fox-muted">
          <p>&copy; {new Date().getFullYear()} LayzzStore. All rights reserved.</p>
          <p>Not affiliated with Moonton, Garena, Tencent or HoYoverse.</p>
        </div>
      </div>
    </footer>
  );
}
