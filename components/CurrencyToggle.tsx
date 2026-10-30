"use client";

export default function CurrencyToggle({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center rounded-full border border-fox-border bg-fox-card px-3 py-1 text-xs font-bold text-fox-text ${className}`}>USD</span>;
}
