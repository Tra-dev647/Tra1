import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TopUpForm from "@/components/TopUpForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const game = await prisma.game.findUnique({
    where: { slug: (await params).slug },
    include: {
      products: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!game || !game.active) notFound();

  return (
    <>
      <Header />

      {/* Game banner */}
      <section className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <Link
          href="/#games"
          className="mb-3 inline-flex items-center gap-2 text-sm text-fox-muted hover:text-fox-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          All games
        </Link>

        <div
          className="aspect-[2/1] w-full overflow-hidden rounded-3xl bg-fox-card"
          style={{
            backgroundImage: `url(${game.bannerUrl || game.imageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center 25%",
          }}
        />

        <div className="card mt-4 flex items-center gap-4 p-4">
          <div
            className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-fox-border bg-fox-card"
            style={{
              backgroundImage: `url(${game.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight">
              {game.name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-green-500/10 px-3 py-1.5 text-xs sm:text-sm text-green-200">
                <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                Secure top-up
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-green-500/10 px-3 py-1.5 text-xs sm:text-sm text-green-200">
                <Zap className="h-4 w-4" strokeWidth={2} />
                Instant delivery
              </span>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10 sm:px-6 lg:px-8">
        <TopUpForm
          game={{
            id: game.id,
            slug: game.slug,
            name: game.name,
            currencyName: game.currencyName,
            uidLabel: game.uidLabel,
            uidExample: game.uidExample,
            requiresServer: game.requiresServer,
            servers: (() => { try { return JSON.parse(game.servers || "[]"); } catch { return []; } })(),
          }}
          products={game.products.map((p) => ({
            id: p.id,
            name: p.name,
            amount: p.amount,
            bonus: p.bonus,
            priceUsd: p.priceUsd,
            badge: p.badge,
          }))}
        />
      </main>

      <Footer />
    </>
  );
}
