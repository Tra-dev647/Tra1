"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { isValidUid, isValidServerId, formatUsd } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { ArrowRight, Lock, Search, UserRoundCheck, AlertCircle, Tag, Loader2, User, HelpCircle, Banknote } from "lucide-react";

// Games that support automatic nickname lookup via /api/lookup-uid
const LOOKUP_SLUGS = new Set(["mobile-legends", "free-fire", "level-up-pass", "genshin-impact", "honkai-star-rail"]);
// MLBB & similar games that use a separate "Zone ID" instead of a server dropdown
const ZONE_ID_SLUGS = new Set(["mobile-legends"]);

interface Product {
  id: string;
  name: string;
  amount: number;
  bonus: number;
  priceUsd: number;
  badge: string | null;
}

interface Game {
  id: string;
  slug: string;
  name: string;
  currencyName: string;
  uidLabel: string;
  uidExample: string | null;
  requiresServer: boolean;
  servers: string[];
}

export default function TopUpForm({ game, products }: { game: Game; products: Product[] }) {
  const { format } = useCurrency();
  const [selected, setSelected] = useState<string | null>(products[0]?.id ?? null);
  const [uid, setUid] = useState("");
  const [serverId, setServerId] = useState(
    ZONE_ID_SLUGS.has(game.slug) ? "" : (game.servers[0] ?? "")
  );
  const [method, setMethod] = useState<"BAKONG">("BAKONG");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promo code state
  const [showHelp, setShowHelp] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    discountUsd: number;
    finalAmountUsd: number;
    discountType: string;
    discountValue: number;
  } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // ── Nickname auto-lookup (debounced 800 ms) ──
  const supportsLookup = LOOKUP_SLUGS.has(game.slug);
  const useZoneField = ZONE_ID_SLUGS.has(game.slug);

  type NicknameStatus = "idle" | "checking" | "verified" | "not_found";
  const [nicknameStatus, setNicknameStatus] = useState<NicknameStatus>("idle");
  const [nickname, setNickname] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset lookup when UID or server changes
  const resetLookup = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    setNicknameStatus("idle");
    setNickname(null);
  }, []);

  // Runs the nickname lookup (used by the debounced effect and the Check ID button)
  const doLookup = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    setNicknameStatus("checking");
    setNickname(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/lookup-uid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameSlug: game.slug,
          uid: uid.trim(),
          server: serverId.trim() || undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json();

      // Guard: component may have unmounted or user typed again
      if (controller.signal.aborted) return;

      if (data.verified && data.nickname) {
        setNickname(data.nickname);
        setNicknameStatus("verified");
      } else {
        setNicknameStatus("not_found");
      }
    } catch {
      // Aborted or network failure
      if (!controller.signal.aborted) {
        setNicknameStatus("not_found");
      }
    }
  }, [game.slug, uid, serverId]);

  const canCheckId = isValidUid(uid) && (!useZoneField || serverId.trim().length > 0);

  // Fire debounced lookup whenever uid/serverId become valid
  useEffect(() => {
    if (!supportsLookup) return;

    // Clear any in-flight lookup
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const uidValid = isValidUid(uid);
    const serverValid = !useZoneField || serverId.trim().length > 0;

    if (!uidValid || !serverValid) {
      // Not ready — stay idle
      if (nicknameStatus !== "idle") {
        setNicknameStatus("idle");
        setNickname(null);
      }
      return;
    }

    debounceRef.current = setTimeout(doLookup, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, serverId, game.slug, supportsLookup, useZoneField]);

  const selectedProduct = products.find((p) => p.id === selected);

  const needsServer = game.requiresServer || useZoneField;
  const canSubmit =
    !!selected &&
    isValidUid(uid) &&
    (!needsServer || serverId.trim().length > 0);

  async function applyPromo() {
    if (!promoInput.trim() || !selectedProduct) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoApplied(null);
    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoInput.trim(),
          orderAmountUsd: selectedProduct.priceUsd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid promo code");
      setPromoApplied(data);
    } catch (err: any) {
      setPromoError(err.message);
    } finally {
      setPromoLoading(false);
    }
  }

  function removePromo() {
    setPromoApplied(null);
    setPromoInput("");
    setPromoError(null);
  }

  // Reset promo when product changes
  const effectivePrice = promoApplied ? promoApplied.finalAmountUsd : (selectedProduct?.priceUsd ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.id,
          productId: selected,
          playerUid: uid.trim(),
          serverId: needsServer ? serverId.trim() : undefined,
          paymentMethod: method,
          promoCode: promoApplied?.code || undefined,
          playerNickname: nickname || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
        {/* Left column: steps */}
        <div className="space-y-4">
      {/* Step 2: UID */}
      <div className="fade-up" style={{ animationDelay: "80ms" }}>
        <div className="card border-white/5 bg-gradient-to-br from-[#272c30] to-[#222d28] p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d9e56f] text-black">
              <User className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <h2 className="flex-1 font-display text-base sm:text-lg font-bold uppercase tracking-wide">
              Enter Your Information
            </h2>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              aria-label="Help"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9e56f]/40 bg-[#d9e56f]/10 text-[#d9e56f]"
            >
              <HelpCircle className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {showHelp && (
            <p className="rounded-xl bg-black/30 px-4 py-3 text-sm text-fox-muted">
              Open the game and tap your profile to find your Game ID
              {useZoneField ? " and Server ID (the number in brackets)" : ""}.
            </p>
          )}

          <div className="space-y-2">
            <div>
              <input
                type="text"
                inputMode="numeric"
                aria-label={useZoneField ? "Game ID" : game.uidLabel}
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                placeholder={useZoneField ? "Enter Game ID" : `Enter ${game.uidLabel}`}
                className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-2.5 text-base text-fox-text placeholder:text-fox-muted focus:outline-none focus:ring-2 focus:ring-fox-primary/30"
                required
              />
              {!uid && game.uidExample && !useZoneField && (
                <p className="text-xs text-fox-muted mt-1.5">
                  Example: <span className="font-mono text-fox-text/70">{game.uidExample}</span>
                </p>
              )}
              {uid && !isValidUid(uid) && (
                <p className="text-xs text-red-400 mt-1">
                  UID should be 5–20 digits.
                </p>
              )}
            </div>
            {useZoneField && (
              <input
                type="text"
                inputMode="numeric"
                aria-label="Server ID"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                placeholder="Enter Server ID"
                className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-2.5 text-base text-fox-text placeholder:text-fox-muted focus:outline-none focus:ring-2 focus:ring-fox-primary/30"
                required
              />
            )}
          </div>

          {game.requiresServer && !useZoneField && (
            <div>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                aria-label="Server"
                className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-2.5 text-base text-fox-text focus:outline-none focus:ring-2 focus:ring-fox-primary/30"
                required
              >
                {game.servers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {supportsLookup && (
            <button
              type="button"
              onClick={doLookup}
              disabled={!canCheckId || nicknameStatus === "checking"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d9e56f] px-4 py-2.5 text-sm font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {nicknameStatus === "checking" ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              ) : (
                <Search className="h-4 w-4" strokeWidth={2.5} />
              )}
              Check ID
            </button>
          )}

          {/* Auto-lookup status indicator */}
          {supportsLookup && nicknameStatus !== "idle" && (
            <div className="pt-1">
              {nicknameStatus === "checking" && (
                <span className="inline-flex items-center gap-2 text-sm text-fox-muted animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Verifying account…
                </span>
              )}

              {nicknameStatus === "verified" && nickname && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-sm text-green-300 animate-scale-in">
                  <UserRoundCheck className="h-4 w-4" strokeWidth={2} />
                  <span className="text-fox-muted">Player:</span>
                  <span className="font-semibold text-green-200">{nickname}</span>
                </span>
              )}

              {nicknameStatus === "not_found" && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-sm text-yellow-300">
                  <AlertCircle className="h-4 w-4" strokeWidth={2} />
                  Couldn&apos;t verify right now — you can still continue to pay
                </span>
              )}
            </div>
          )}


        </div>
      </div>

      {/* Step 1: Pick package */}
      <div className="fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
            <span className="absolute inset-0 rounded-full bg-fox-primary/40 animate-ping" />
            <span className="relative">2</span>
          </div>
          <h2 className="font-display text-xl font-bold">Choose Package</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {products.map((p) => {
            const isSelected = selected === p.id;
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`relative flex items-center gap-2 rounded-xl border-2 p-2 text-left transition-all duration-200 active:scale-[0.98] ${
                  isSelected
                    ? "border-[#b5f01a] bg-[#1b2713] shadow-lg shadow-[#b5f01a]/10"
                    : "border-[#2a3328] bg-[#141a14] hover:border-[#b5f01a]/50"
                }`}
              >
                {p.badge && (
                  <div className="absolute -top-2 right-2 scale-90">
                    {p.badge === "Hot" && <span className="badge-hot">Hot</span>}
                    {p.badge === "Best Value" && <span className="badge-best">Best</span>}
                    {p.badge === "Pass" && <span className="badge-pass">Pass</span>}
                    {!["Hot", "Best Value", "Pass"].includes(p.badge) && (
                      <span className="badge-best">{p.badge}</span>
                    )}
                  </div>
                )}

                <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/games/diamond.png"
                    alt=""
                    className="h-6 w-6 sm:h-8 sm:w-8 object-contain"
                  />
                </div>

                <div className="min-w-0">
                  <div className="font-display text-base sm:text-lg font-bold leading-tight text-[#b5f01a]">
                    {format(p.priceUsd)}
                  </div>
                  <div className="truncate text-xs sm:text-sm font-bold leading-tight text-fox-text">
                    {p.amount > 0
                      ? `${p.amount.toLocaleString()} ${game.currencyName}`
                      : p.name}
                  </div>
                  {p.amount > 0 && p.bonus > 0 && (
                    <div className="text-xs font-semibold text-fox-accent">+ {p.bonus} bonus</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Payment method */}
      <div className="fade-up" style={{ animationDelay: "160ms" }}>
        <div className="card border-white/5 bg-gradient-to-br from-[#272c30] to-[#222d28] p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d9e56f] text-black">
              <Banknote className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <h2 className="font-display text-base sm:text-lg font-bold uppercase tracking-wide">
              Payment Method
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setMethod("BAKONG")}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-[#b5f01a] bg-[#212d16] p-3 text-left"
          >
            {/* Bakong logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/payments/bakong.png"
              alt="Bakong"
              className="h-12 w-12 shrink-0 rounded-xl object-cover sm:h-14 sm:w-14"
            />
            <div className="min-w-0">
              <div className="text-base font-bold text-white sm:text-lg">Bakong KHQR</div>
              <div className="text-xs text-white/90 sm:text-sm">
                Scan to pay with any banking app
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Coupon */}
      <div className="fade-up" style={{ animationDelay: "200ms" }}>
        <div className="card border-white/5 bg-gradient-to-br from-[#272c30] to-[#222d28] p-4 sm:p-5">
          <h3 className="mb-2 font-display text-base font-semibold">Coupon</h3>

          {promoApplied ? (
            <div className="flex items-center gap-3 rounded-xl border border-[#b5f01a]/40 bg-[#b5f01a]/10 p-3">
              <Tag className="h-4 w-4 shrink-0 text-[#b5f01a]" />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-sm font-bold text-[#b5f01a]">{promoApplied.code}</span>
                <span className="ml-2 text-xs text-[#b5f01a]/80">
                  −{format(promoApplied.discountUsd)} off
                </span>
              </div>
              <button
                type="button"
                onClick={removePromo}
                className="text-xs text-fox-muted transition-colors hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                placeholder="Enter coupon code"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-base uppercase text-fox-text placeholder:normal-case placeholder:text-fox-muted focus:outline-none focus:ring-2 focus:ring-[#b5f01a]/30"
              />
              <button
                type="button"
                onClick={applyPromo}
                disabled={promoLoading || !promoInput.trim() || !selectedProduct}
                className="shrink-0 rounded-xl bg-[#b5f01a] px-5 text-sm font-bold text-black transition-opacity disabled:bg-[#3b4d1f] disabled:text-[#9aa389]"
              >
                {promoLoading ? "..." : "Apply"}
              </button>
            </div>
          )}
          {promoError && (
            <p className="mt-2 text-sm text-red-400">{promoError}</p>
          )}
        </div>
      </div>

        </div>{/* end left column */}

        {/* Right column: sticky order summary (desktop only) */}
        <div className="hidden lg:block">
          <div className="sticky top-24">
            <div className="card-glow p-6 border border-fox-primary/20">
              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fox-muted mb-4">Order Summary</h3>

              {selectedProduct ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-fox-muted">{game.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fox-muted">Package</span>
                    <span className="font-medium">
                      {selectedProduct.amount > 0
                        ? `${selectedProduct.amount.toLocaleString()} ${game.currencyName}`
                        : selectedProduct.name}
                    </span>
                  </div>
                  {selectedProduct.bonus > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-fox-muted">Bonus</span>
                      <span className="text-fox-accent font-semibold">+{selectedProduct.bonus}</span>
                    </div>
                  )}
                  {uid && (
                    <div className="flex justify-between text-sm">
                      <span className="text-fox-muted">Player ID</span>
                      <span className="font-mono text-xs">{uid}{serverId ? ` (${serverId})` : ""}</span>
                    </div>
                  )}
                  {nickname && (
                    <div className="flex justify-between text-sm">
                      <span className="text-fox-muted">Player</span>
                      <span className="text-green-400 font-medium text-xs">{nickname}</span>
                    </div>
                  )}
                  <div className="border-t border-fox-border pt-3 space-y-2">
                    {promoApplied && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-fox-muted">Subtotal</span>
                          <span className="text-fox-muted line-through">{format(selectedProduct.priceUsd)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-green-400">Discount ({promoApplied.code})</span>
                          <span className="text-green-400 font-semibold">−{format(promoApplied.discountUsd)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-fox-muted text-sm">Total</span>
                      <div className="text-right">
                        <span key={selectedProduct.id} className="font-display text-3xl font-bold text-gradient animate-scale-in inline-block">
                          {format(effectivePrice)}
                        </span>

                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-fox-muted">Select a package to see pricing</p>
              )}

              {error && (
                <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="btn-primary w-full text-base mt-5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {submitting ? "Creating order..." : "Pay Now"}
                {!submitting && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-xs text-fox-muted text-center mt-3">
                <Lock className="h-3 w-3" strokeWidth={2.5} />
                Secure checkout · No account needed
              </p>
            </div>
          </div>
        </div>
      </div>{/* end grid */}

      {/* Mobile: sticky bottom summary */}
      <div className="lg:hidden card-glow p-4 mt-5 border border-fox-primary/30">
        {selectedProduct && (
          <div className="flex justify-between items-center mb-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-fox-muted">Total</div>
              <div key={selectedProduct.id} className="font-display text-2xl font-bold text-gradient animate-scale-in">
                {format(effectivePrice)}
              </div>

              {promoApplied && (
                <div className="text-xs text-green-400">−{format(promoApplied.discountUsd)} off</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-fox-muted">
                {selectedProduct.amount > 0
                  ? `${selectedProduct.amount.toLocaleString()} ${game.currencyName}`
                  : selectedProduct.name}
              </div>
              {selectedProduct.bonus > 0 && (
                <div className="text-xs text-fox-accent">
                  + {selectedProduct.bonus} bonus
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="btn-primary w-full !py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {submitting ? "Creating order..." : "Pay Now"}
          {!submitting && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-fox-muted text-center mt-2">
          <Lock className="h-3 w-3" strokeWidth={2.5} />
          Secure checkout · No account needed
        </p>
      </div>
    </form>
  );
}
