import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUpdateBooking, useCalculatePricing, useListDiscountTiers, customFetch, type PricingRequestPassType, type DiscountTier } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Check, Minus, Plus, Users, Flame, AlertCircle, TrendingUp, Star, Tag, X } from "lucide-react";
import type { BookingWithAttendees } from "@/types/booking";

interface Step2PassesProps {
  booking: BookingWithAttendees;
}

const DEFAULT_SINGLE_BENEFITS = [
  "Conference Sessions",
  "Networking Sessions",
  "Happy Hour with Entertainment",
  "Exhibition Hall",
  "Award-winning Food & Drink",
  "On-Demand Recordings",
  "Additional Content Access",
  "Presentation Slides",
  "Post-Event Content",
];

const DEFAULT_BUSINESS_EXTRA_BENEFITS = [
  "Exclusive Attendee Report",
  "Company Branding at the Summit",
];

interface PassConfig {
  passType: string;
  currentPrice: string;
  originalPrice: string;
  pricingPeriodName: string;
  benefits: string[];
  extraBenefits: string[];
}

function getActiveTier(tiers: DiscountTier[], passType: string, qty: number): DiscountTier | null {
  const relevant = tiers
    .filter(t => t.passType === passType)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  let active: DiscountTier | null = null;
  for (const tier of relevant) {
    if (qty >= tier.minQuantity) active = tier;
  }
  return active;
}

function getNextTier(tiers: DiscountTier[], passType: string, qty: number): DiscountTier | null {
  const relevant = tiers
    .filter(t => t.passType === passType)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  return relevant.find(t => t.minQuantity > qty) ?? null;
}

interface TierRow {
  key: string;
  label: string;
  note: string;
  active: boolean;
  isSpecial?: boolean;
}

function buildHRTierRows(tiers: DiscountTier[], qty: number, pricePerTicket: number): TierRow[] {
  const relevant = tiers
    .filter(t => t.passType === "single")
    .sort((a, b) => a.minQuantity - b.minQuantity);

  const rows: TierRow[] = [];

  if (relevant.length === 0) {
    rows.push({ key: "all", label: "All quantities", note: `£${pricePerTicket}/ticket`, active: true });
    return rows;
  }

  const firstTierMin = relevant[0].minQuantity;
  const noDiscountEnd = firstTierMin - 1;

  if (noDiscountEnd >= 3) {
    rows.push({ key: "1-2", label: "1–2 tickets", note: `£${pricePerTicket}/ticket`, active: qty <= 2 });
    rows.push({ key: "3", label: "3 tickets", note: "Most Popular", active: qty === 3, isSpecial: true });
    if (noDiscountEnd > 3) {
      rows.push({
        key: `4-${noDiscountEnd}`,
        label: `4–${noDiscountEnd} tickets`,
        note: `£${pricePerTicket}/ticket`,
        active: qty >= 4 && qty <= noDiscountEnd,
      });
    }
  } else if (noDiscountEnd >= 1) {
    rows.push({
      key: `1-${noDiscountEnd}`,
      label: noDiscountEnd === 1 ? "1 ticket" : `1–${noDiscountEnd} tickets`,
      note: `£${pricePerTicket}/ticket`,
      active: qty <= noDiscountEnd,
    });
  }

  for (let i = 0; i < relevant.length; i++) {
    const tier = relevant[i];
    const nextTier = relevant[i + 1];
    const maxQty = nextTier ? nextTier.minQuantity - 1 : null;
    const savingPerTicket = (pricePerTicket * tier.discountPercent / 100).toFixed(2);
    const rangeLabel = maxQty
      ? `${tier.minQuantity}–${maxQty} tickets`
      : `${tier.minQuantity}+ tickets`;
    rows.push({
      key: rangeLabel,
      label: rangeLabel,
      note: `${tier.discountPercent}% off — save £${savingPerTicket}/ticket`,
      active: qty >= tier.minQuantity && (maxQty === null || qty <= maxQty),
    });
  }

  return rows;
}

function buildBusinessTierRows(tiers: DiscountTier[], qty: number, pricePerPass: number): TierRow[] {
  const relevant = tiers
    .filter(t => t.passType === "business")
    .sort((a, b) => a.minQuantity - b.minQuantity);

  const rows: TierRow[] = [];

  if (relevant.length === 0) {
    rows.push({ key: "all", label: "All quantities", note: `£${pricePerPass}/pass`, active: true });
    return rows;
  }

  const firstTierMin = relevant[0].minQuantity;
  const noDiscountEnd = firstTierMin - 1;

  if (noDiscountEnd >= 1) {
    rows.push({
      key: `1-${noDiscountEnd}`,
      label: noDiscountEnd === 1 ? "1 pass" : `1–${noDiscountEnd} passes`,
      note: `£${pricePerPass}/pass`,
      active: qty <= noDiscountEnd,
    });
  }

  for (let i = 0; i < relevant.length; i++) {
    const tier = relevant[i];
    const nextTier = relevant[i + 1];
    const maxQty = nextTier ? nextTier.minQuantity - 1 : null;
    const savingPerPass = (pricePerPass * tier.discountPercent / 100).toFixed(2);
    const rangeLabel = maxQty
      ? `${tier.minQuantity}–${maxQty} pass${maxQty > 1 ? "es" : ""}`
      : `${tier.minQuantity}+ passes`;
    rows.push({
      key: rangeLabel,
      label: rangeLabel,
      note: `${tier.discountPercent}% off — save £${savingPerPass}/pass`,
      active: qty >= tier.minQuantity && (maxQty === null || qty <= maxQty),
    });
  }

  return rows;
}

function InventoryBadge({ remaining, className = "" }: { remaining: number | null; className?: string }) {
  if (remaining === null) return null;

  if (remaining <= 5) {
    return (
      <div className={`flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-sm ${className}`}>
        <Flame className="w-3.5 h-3.5" />
        Only {remaining} {remaining === 1 ? "spot" : "spots"} left!
      </div>
    );
  }
  if (remaining <= 20) {
    return (
      <div className={`flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-sm ${className}`}>
        <AlertCircle className="w-3.5 h-3.5" />
        {remaining} spots remaining — selling fast
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-sm ${className}`}>
      <AlertCircle className="w-3.5 h-3.5" />
      {remaining} spots remaining
    </div>
  );
}

interface UpsellNudgeProps {
  tiers: DiscountTier[];
  passType: string;
  quantity: number;
  unitLabel: string;
}

function UpsellNudge({ tiers, passType, quantity, unitLabel }: UpsellNudgeProps) {
  const nextTier = getNextTier(tiers, passType, quantity);
  if (!nextTier) return null;

  const needed = nextTier.minQuantity - quantity;
  if (needed > 3) return null;

  const currentTier = getActiveTier(tiers, passType, quantity);
  const currentDiscountPct = currentTier?.discountPercent ?? 0;
  const basePrice = passType === "business" ? 599 : 199;
  const upliftValue =
    nextTier.minQuantity * basePrice * nextTier.discountPercent / 100 -
    quantity * basePrice * currentDiscountPct / 100;
  const uplift = upliftValue.toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-start gap-2.5 bg-accent/20 border border-accent px-3 py-2.5 text-xs text-foreground"
    >
      <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-secondary" />
      <span>
        <span className="font-bold">Add {needed} more {unitLabel}{needed > 1 ? "s" : ""}</span> to unlock{" "}
        <span className="font-bold text-secondary">{nextTier.discountPercent}% off</span>
        {upliftValue > 0 && (
          <span> — save an extra <span className="font-bold text-secondary">£{uplift}</span> on your order</span>
        )}
        !
      </span>
    </motion.div>
  );
}

export default function Step2Passes({ booking }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const isHR = booking.attendeeType === "hr_professional";
  const isVendor = booking.attendeeType === "consultant_vendor";

  const resolveInitialPass = (): PricingRequestPassType => {
    const stored = booking.passType as PricingRequestPassType;
    if (isVendor) return "business";
    if (isHR && (stored === "business" || stored === "team")) return "single";
    return stored || "single";
  };

  const [selectedPass] = useState<PricingRequestPassType>(resolveInitialPass);
  const [quantity, setQuantity] = useState<number>(() => booking.quantity || 1);
  const [inventory, setInventory] = useState<Record<string, number | null>>({ single: null, business: null });
  const [passConfig, setPassConfig] = useState<Record<string, PassConfig | null>>({ single: null, business: null });

  const [promoInput, setPromoInput] = useState<string>("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(booking.promoCode ?? null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoValidating, setPromoValidating] = useState(false);

  const calculatePricingMutation = useCalculatePricing();
  const queryClient = useQueryClient();

  const { data: allTiers = [] } = useListDiscountTiers();

  useEffect(() => {
    fetch("/api/passes/inventory")
      .then(res => res.ok ? res.json() : {})
      .then(data => setInventory(data))
      .catch(() => {});
    fetch("/api/passes/config")
      .then(res => res.ok ? res.json() : {})
      .then(data => setPassConfig(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: { passType: selectedPass, quantity, promoCode: appliedPromoCode ?? undefined },
    });
  }, [selectedPass, quantity, appliedPromoCode]);

  const currentPricing = calculatePricingMutation.data;

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoValidating(true);
    setPromoError(null);
    try {
      const res = await customFetch(`/api/promo-codes/validate`, {
        method: "POST",
        body: JSON.stringify({ code, passType: selectedPass, quantity }),
      });
      const data = res as { valid?: boolean; error?: string; code?: string };
      if (data.valid && data.code) {
        setAppliedPromoCode(data.code);
        setPromoInput("");
      } else {
        setPromoError(data.error || "Invalid promo code");
      }
    } catch (e: any) {
      setPromoError(e?.data?.error || e?.message || "Invalid or expired promo code");
    } finally {
      setPromoValidating(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromoCode(null);
    setPromoInput("");
    setPromoError(null);
  };

  const handleContinue = async () => {
    await updateBooking.mutateAsync({
      id: booking.id,
      data: {
        passType: selectedPass as "single" | "business",
        quantity,
        promoCode: appliedPromoCode ?? undefined,
        currentStep: 3,
      },
    });
    queryClient.invalidateQueries({ queryKey: ["booking"] });
  };

  const activeTier = getActiveTier(allTiers, selectedPass, quantity);
  const discountLabel = activeTier ? `${activeTier.discountPercent}% off` : null;
  const isMostPopular = isHR && quantity === 3 && !activeTier;

  const hrUnitPrice = currentPricing?.pricePerHead ?? 199;
  const businessUnitPrice = currentPricing?.pricePerHead ?? 599;
  const hrTierRows = buildHRTierRows(allTiers, quantity, hrUnitPrice);
  const businessTierRows = buildBusinessTierRows(allTiers, quantity, businessUnitPrice);

  const singleCfg = passConfig.single;
  const businessCfg = passConfig.business;

  const singleCurrentPrice = singleCfg ? parseFloat(singleCfg.currentPrice) : 199;
  const singleOriginalPrice = singleCfg ? parseFloat(singleCfg.originalPrice) : 429;
  const singlePeriodName = singleCfg?.pricingPeriodName ?? "Early Bird";
  const singleDiscountPct = singleOriginalPrice > singleCurrentPrice
    ? Math.round(((singleOriginalPrice - singleCurrentPrice) / singleOriginalPrice) * 100)
    : null;
  const singleBenefits = singleCfg && singleCfg.benefits.length > 0 ? singleCfg.benefits : DEFAULT_SINGLE_BENEFITS;

  const businessCurrentPrice = businessCfg ? parseFloat(businessCfg.currentPrice) : 599;
  const businessOriginalPrice = businessCfg ? parseFloat(businessCfg.originalPrice) : 999;
  const businessPeriodName = businessCfg?.pricingPeriodName ?? "Early Bird";
  const businessDiscountPct = businessOriginalPrice > businessCurrentPrice
    ? Math.round(((businessOriginalPrice - businessCurrentPrice) / businessOriginalPrice) * 100)
    : null;
  const businessBenefits = businessCfg && businessCfg.benefits.length > 0 ? businessCfg.benefits : DEFAULT_SINGLE_BENEFITS;
  const businessExtraBenefits = businessCfg && businessCfg.extraBenefits.length > 0 ? businessCfg.extraBenefits : DEFAULT_BUSINESS_EXTRA_BENEFITS;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Select your pass</h1>
        <p className="text-lg text-muted-foreground">
          {isVendor
            ? "Your Business Pass gives you exclusive access and visibility at the summit."
            : "Choose how many tickets you need. Group discounts apply automatically."}
        </p>
      </div>
      {/* HR: Single pass with quantity picker */}
      {isHR && (
        <Card className="relative border-2 border-primary overflow-hidden p-0 shadow-lg">
          {/* ── Header band ── */}
          <div className="px-6 md:px-8 py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-semibold">HR Analytics Summit · 3 Sep 2026, London</p>
              <h3 className="text-2xl font-bold text-primary font-display leading-tight">HR Professional Pass</h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <InventoryBadge remaining={inventory.single} />
              <div className="text-right">
                <div className="flex items-baseline gap-2 justify-end flex-wrap">
                  <span className="text-3xl font-bold text-foreground">£{singleCurrentPrice.toFixed(0)}</span>
                  {singleOriginalPrice > singleCurrentPrice && (
                    <span className="text-sm text-muted-foreground line-through">£{singleOriginalPrice.toFixed(0)}</span>
                  )}
                  {singleDiscountPct !== null && (
                    <span className="badge-shine text-xs font-bold px-3 py-1 rounded-full inline-block">{singleDiscountPct}% off</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Per ticket, ex VAT · {singlePeriodName}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start">

            {/* ── Left column: Benefits ── */}
            <div className="flex-1 p-6 md:p-8">
              {/* Benefits grid */}
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">What's included</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                {singleBenefits.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Column separator */}
            <div className="hidden md:block w-px bg-border self-stretch" />

            {/* ── Right column: Quantity picker (warm panel) ── */}
            <div className="md:w-80 shrink-0 p-6 bg-muted space-y-4 ml-[0px]">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                How many tickets?
              </p>

              {/* 3 tickets shortcut */}
              <button
                type="button"
                onClick={() => setQuantity(3)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-bold transition-colors ${
                  quantity === 3
                    ? "bg-primary text-white shadow-md"
                    : "text-white shadow-md hover:shadow-lg"
                }`}
                style={
                  quantity !== 3
                    ? { background: "linear-gradient(135deg, hsl(28,88%,62%) 0%, hsl(4,77%,57%) 100%)" }
                    : undefined
                }
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 shrink-0" />
                  3 tickets — Most Popular
                </span>
                <Check className={`w-4 h-4 shrink-0 transition-opacity ${quantity === 3 ? "opacity-100" : "opacity-0"}`} />
              </button>

              {/* Custom stepper */}
              <div className="flex items-stretch border border-border bg-white overflow-hidden">
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center font-bold text-2xl py-2.5 text-foreground border-x border-border">
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onClick={() => setQuantity(q => Math.min(20, q + 1))}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Upsell nudge — fixed-height container prevents layout shift */}
              <div className="min-h-[56px]">
                <AnimatePresence>
                  <UpsellNudge
                    tiers={allTiers}
                    passType="single"
                    quantity={quantity}
                    unitLabel="ticket"
                  />
                </AnimatePresence>
              </div>

              {/* Tier table */}
              <div className="space-y-1 text-xs">
                {hrTierRows.map(({ key, label, note, active, isSpecial }) => (
                  <div
                    key={key}
                    className={`flex justify-between px-2 py-1.5 transition-all ${
                      active
                        ? "border-l-4 border-primary bg-primary/10 text-foreground font-semibold pl-2"
                        : "text-muted-foreground pl-[6px]"
                    }`}
                  >
                    <span>{label}</span>
                    <span className={active ? "text-primary font-bold" : ""}>
                      {note}
                    </span>
                  </div>
                ))}
              </div>

              {/* Discount applied indicator */}
              {discountLabel && (
                <div className="flex items-center gap-2 border-l-4 border-primary bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                  <Check className="w-4 h-4 shrink-0" />
                  {discountLabel} group discount applied
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
      {/* Vendor: Business Pass with quantity + discounts */}
      {isVendor && (
        <Card className="relative border-2 border-primary overflow-hidden p-0 shadow-lg">
          {/* ── Header band ── */}
          <div className="px-6 md:px-8 py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-semibold">HR Analytics Summit · 3 Sep 2026 · Consultants &amp; Vendors</p>
              <h3 className="text-2xl font-bold text-primary font-display leading-tight">Business Pass</h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <InventoryBadge remaining={inventory.business} />
              <div className="text-right">
                <div className="flex items-baseline gap-2 justify-end flex-wrap">
                  <span className="text-3xl font-bold text-foreground">£{businessCurrentPrice.toFixed(0)}</span>
                  {businessOriginalPrice > businessCurrentPrice && (
                    <span className="text-sm text-muted-foreground line-through">£{businessOriginalPrice.toFixed(0)}</span>
                  )}
                  {businessDiscountPct !== null && (
                    <span className="badge-shine text-xs font-bold px-3 py-1 rounded-full inline-block">{businessDiscountPct}% off</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Per pass, ex VAT · {businessPeriodName}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start">

            {/* ── Left column: Benefits ── */}
            <div className="flex-1 p-6 md:p-8">
              {/* Standard benefits */}
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">What's included</p>
              <div className="space-y-2 mb-4">
                {businessBenefits.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              {/* Exclusive / premium benefits */}
              {businessExtraBenefits.length > 0 && (
                <div className="border-t border-border pt-3 mt-3 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-gold mb-2">Exclusive to Business Pass</p>
                  {businessExtraBenefits.map((b) => (
                    <div key={b} className="flex items-start gap-2 text-sm font-semibold border-l-2 border-gold pl-2">
                      <Star className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Column separator */}
            <div className="hidden md:block w-px bg-border self-stretch" />

            {/* ── Right column: Quantity picker (warm panel) ── */}
            <div className="md:w-72 shrink-0 p-6 bg-muted space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                How many passes?
              </p>

              {/* Custom stepper */}
              <div className="flex items-stretch border border-border bg-white overflow-hidden">
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center font-bold text-2xl py-2.5 text-foreground border-x border-border">
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.min(10, q + 1))}
                  disabled={quantity >= 10}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Upsell nudge — fixed-height container prevents layout shift */}
              <div className="min-h-[56px]">
                <AnimatePresence>
                  <UpsellNudge
                    tiers={allTiers}
                    passType="business"
                    quantity={quantity}
                    unitLabel="pass"
                  />
                </AnimatePresence>
              </div>

              {/* Business discount tiers */}
              <div className="space-y-1 text-xs">
                {businessTierRows.map(({ key, label, note, active }) => (
                  <div
                    key={key}
                    className={`flex justify-between px-2 py-1.5 transition-all ${
                      active
                        ? "border-l-4 border-primary bg-primary/10 text-foreground font-semibold pl-2"
                        : "text-muted-foreground pl-[6px]"
                    }`}
                  >
                    <span>{label}</span>
                    <span className={active ? "text-primary font-bold" : ""}>{note}</span>
                  </div>
                ))}
              </div>

              {/* Discount applied indicator */}
              {discountLabel && (
                <div className="flex items-center gap-2 border-l-4 border-primary bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                  <Check className="w-4 h-4 shrink-0" />
                  {discountLabel} group discount applied
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
      {/* ── Order Summary ── */}
      <div className="bg-white border border-border flex flex-col md:flex-row md:items-start justify-between gap-0 md:gap-8 overflow-hidden">

        {/* Left: selection summary */}
        <div className="flex-1 p-6 md:p-8 space-y-1">
          <h2 className="text-xl font-bold">
            {quantity} {isHR ? `ticket${quantity !== 1 ? "s" : ""}` : `pass${quantity !== 1 ? "es" : ""}`} selected
          </h2>
          {discountLabel && !isMostPopular && (
            <p className="text-sm font-semibold text-secondary">{discountLabel} group discount applied</p>
          )}
          {isMostPopular && (
            <p className="text-sm font-semibold text-secondary">Most popular choice for teams</p>
          )}
          <p className="text-sm text-muted-foreground pt-1">
            You'll add attendee details in the next step.
          </p>

          {/* Promo code input */}
          <div className="pt-4 space-y-2">
            {appliedPromoCode ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-2 text-sm font-semibold text-green-800">
                <Tag className="w-4 h-4 shrink-0" />
                <span className="flex-1">Code <span className="font-mono">{appliedPromoCode}</span> applied</span>
                <button
                  type="button"
                  onClick={handleRemovePromo}
                  className="ml-auto text-green-600 hover:text-green-800 transition-colors"
                  aria-label="Remove promo code"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Promo Code</p>
                <div className="flex gap-2">
                  <Input
                    className="h-10 uppercase bg-white text-sm font-mono"
                    placeholder="Enter code"
                    value={promoInput}
                    onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                    onKeyDown={e => e.key === "Enter" && handleApplyPromo()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 border-border shrink-0"
                    onClick={handleApplyPromo}
                    disabled={promoValidating || !promoInput.trim()}
                  >
                    {promoValidating ? "Checking…" : "Apply"}
                  </Button>
                </div>
                {promoError && (
                  <p className="text-xs text-red-600 font-medium">{promoError}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: price breakdown */}
        <div className="bg-muted p-6 md:p-8 min-w-[280px]">
          <h3 className="text-lg font-bold mb-4">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span>
                  {selectedPass === "business"
                    ? `${quantity} × Business Pass`
                    : `${quantity} × HR Professional Pass`}
                </span>
                <span>£{currentPricing.baseSubtotal.toFixed(2)}</span>
              </div>

              {currentPricing.groupDiscountAmount > 0 && (
                <div className="flex justify-between text-sm font-bold text-secondary">
                  <span>Group Discount ({currentPricing.groupDiscountPercent}%)</span>
                  <span>-£{currentPricing.groupDiscountAmount.toFixed(2)}</span>
                </div>
              )}

              {currentPricing.promoDiscountAmount > 0 && (
                <div className="flex justify-between text-sm font-bold text-primary">
                  <span className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 shrink-0" />
                    Promo Code
                  </span>
                  <span>-£{currentPricing.promoDiscountAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>£{currentPricing.subtotalAfterDiscounts.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>VAT (20%)</span>
                <span>£{currentPricing.vatAmount.toFixed(2)}</span>
              </div>

              <div className="pt-3 border-t border-border flex justify-between font-bold text-2xl">
                <span>Total</span>
                <span>£{currentPricing.total.toFixed(2)}</span>
              </div>

              {currentPricing.savedAmount > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="savings-pulse flex justify-between items-center text-sm font-bold bg-success text-success-foreground px-4 py-2.5 -mx-2 mt-1"
                >
                  <span className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 shrink-0" />
                    You're saving
                  </span>
                  <span className="text-lg font-bold">
                    £{(currentPricing.savedAmount * (1 + currentPricing.vatRate)).toFixed(2)}
                  </span>
                </motion.div>
              )}
            </div>
          ) : (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-border w-full rounded"></div>
              <div className="h-4 bg-border w-2/3 rounded"></div>
              <div className="h-4 bg-border w-full rounded"></div>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          size="lg"
          className="px-8 h-14 text-lg border-border"
          onClick={async () => {
            await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 1 } });
            queryClient.invalidateQueries({ queryKey: ["booking"] });
          }}
        >
          Back
        </Button>
        <Button
          size="lg"
          className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none"
          onClick={handleContinue}
          disabled={calculatePricingMutation.isPending}
        >
          Continue to Attendees
        </Button>
      </div>
    </div>
  );
}
