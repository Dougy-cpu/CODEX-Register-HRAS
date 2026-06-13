import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useUpdateBooking,
  calculatePricing,
  useListDiscountTiers,
  customFetch,
  type PricingRequestPassType,
  type DiscountTier,
  type PricingBreakdown,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import SaveAndReturnButton from "@/components/checkout/SaveAndReturnButton";
import {
  Check,
  Minus,
  Plus,
  Users,
  Flame,
  AlertCircle,
  TrendingUp,
  Star,
  Tag,
  X,
} from "lucide-react";
import type { BookingWithAttendees } from "@/types/booking";
import { CompShortfallPrompt } from "./CompShortfallPrompt";

interface Step2PassesProps {
  booking: BookingWithAttendees;
  onAdvance?: (step: number) => void;
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

const FALLBACK_HEAR_OPTIONS = [
  "LinkedIn",
  "Google / Search engine",
  "Email newsletter",
  "Word of mouth / Colleague",
  "Previous attendee",
  "Industry publication or press",
  "Podcast",
  "Social media",
  "Other",
];

function getActiveTier(tiers: DiscountTier[], passType: string, qty: number): DiscountTier | null {
  const relevant = tiers
    .filter((t) => t.passType === passType)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  let active: DiscountTier | null = null;
  for (const tier of relevant) {
    if (qty >= tier.minQuantity) active = tier;
  }
  return active;
}

function getNextTier(tiers: DiscountTier[], passType: string, qty: number): DiscountTier | null {
  const relevant = tiers
    .filter((t) => t.passType === passType)
    .sort((a, b) => a.minQuantity - b.minQuantity);
  return relevant.find((t) => t.minQuantity > qty) ?? null;
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
    .filter((t) => t.passType === "single")
    .sort((a, b) => a.minQuantity - b.minQuantity);

  const rows: TierRow[] = [];

  if (relevant.length === 0) {
    rows.push({
      key: "all",
      label: "All quantities",
      note: `£${pricePerTicket}/pass`,
      active: true,
    });
    return rows;
  }

  const firstTierMin = relevant[0].minQuantity;
  const noDiscountEnd = firstTierMin - 1;

  if (noDiscountEnd >= 3) {
    rows.push({
      key: "1-2",
      label: "1 to 2 passes",
      note: `£${pricePerTicket}/pass`,
      active: qty <= 2,
    });
    rows.push({
      key: "3",
      label: "3 passes",
      note: "Most Popular",
      active: qty === 3,
      isSpecial: true,
    });
    if (noDiscountEnd > 3) {
      rows.push({
        key: `4-${noDiscountEnd}`,
        label: `4 to ${noDiscountEnd} passes`,
        note: `£${pricePerTicket}/pass`,
        active: qty >= 4 && qty <= noDiscountEnd,
      });
    }
  } else if (noDiscountEnd >= 1) {
    rows.push({
      key: `1-${noDiscountEnd}`,
      label: noDiscountEnd === 1 ? "1 pass" : `1 to ${noDiscountEnd} passes`,
      note: `£${pricePerTicket}/pass`,
      active: qty <= noDiscountEnd,
    });
  }

  for (let i = 0; i < relevant.length; i++) {
    const tier = relevant[i];
    const nextTier = relevant[i + 1];
    const maxQty = nextTier ? nextTier.minQuantity - 1 : null;
    const savingPerTicket = ((pricePerTicket * tier.discountPercent) / 100).toFixed(2);
    const rangeLabel = maxQty
      ? `${tier.minQuantity} to ${maxQty} passes`
      : `${tier.minQuantity}+ passes`;
    rows.push({
      key: rangeLabel,
      label: rangeLabel,
      note: `${tier.discountPercent}% off, save £${savingPerTicket}/pass`,
      active: qty >= tier.minQuantity && (maxQty === null || qty <= maxQty),
    });
  }

  return rows;
}

function buildBusinessTierRows(
  tiers: DiscountTier[],
  qty: number,
  pricePerPass: number,
): TierRow[] {
  const relevant = tiers
    .filter((t) => t.passType === "business")
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
      label: noDiscountEnd === 1 ? "1 pass" : `1 to ${noDiscountEnd} passes`,
      note: `£${pricePerPass}/pass`,
      active: qty <= noDiscountEnd,
    });
  }

  for (let i = 0; i < relevant.length; i++) {
    const tier = relevant[i];
    const nextTier = relevant[i + 1];
    const maxQty = nextTier ? nextTier.minQuantity - 1 : null;
    const savingPerPass = ((pricePerPass * tier.discountPercent) / 100).toFixed(2);
    const rangeLabel = maxQty
      ? `${tier.minQuantity} to ${maxQty} pass${maxQty > 1 ? "es" : ""}`
      : `${tier.minQuantity}+ passes`;
    rows.push({
      key: rangeLabel,
      label: rangeLabel,
      note: `${tier.discountPercent}% off, save £${savingPerPass}/pass`,
      active: qty >= tier.minQuantity && (maxQty === null || qty <= maxQty),
    });
  }

  return rows;
}

function InventoryBadge({
  remaining,
  className = "",
}: {
  remaining: number | null;
  className?: string;
}) {
  if (remaining === null) return null;

  if (remaining <= 5) {
    return (
      <div
        className={`flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-md ${className}`}
      >
        <Flame className="w-3.5 h-3.5" />
        Only {remaining} {remaining === 1 ? "pass" : "passes"} left!
      </div>
    );
  }
  if (remaining <= 20) {
    return (
      <div
        className={`flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md ${className}`}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        {remaining} passes remaining, selling fast
      </div>
    );
  }
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-md ${className}`}
    >
      <AlertCircle className="w-3.5 h-3.5" />
      {remaining} passes remaining
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
    (nextTier.minQuantity * basePrice * nextTier.discountPercent) / 100 -
    (quantity * basePrice * currentDiscountPct) / 100;
  const uplift = upliftValue.toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-start gap-2.5 rounded-md border border-primary/15 bg-white px-3 py-2.5 text-xs leading-relaxed text-foreground shadow-sm"
    >
      <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
      <span>
        <span className="font-bold">
          Add {needed} more {unitLabel}
          {needed > 1 ? "s" : ""}
        </span>{" "}
        to reach the next group discount:{" "}
        <span className="font-bold text-primary">{nextTier.discountPercent}% off</span>
        {upliftValue > 0 && (
          <span>
            {" "}
            and save an extra <span className="font-bold text-secondary">£{uplift}</span> on your
            order
          </span>
        )}
        !
      </span>
    </motion.div>
  );
}

export default function Step2Passes({ booking, onAdvance }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const isHR = booking.attendeeType === "hr_professional";
  const isVendor = booking.attendeeType === "consultant_vendor";

  const resolveInitialPass = (): PricingRequestPassType => {
    const stored = booking.passType as PricingRequestPassType;
    if (isVendor) return "business";
    if (isHR && stored === "business") return "single";
    return stored || "single";
  };

  const [selectedPass] = useState<PricingRequestPassType>(resolveInitialPass);
  const [quantity, setQuantity] = useState<number>(() => booking.quantity || 1);
  const [inventory, setInventory] = useState<Record<string, number | null>>({
    single: null,
    business: null,
  });
  const [passConfig, setPassConfig] = useState<Record<string, PassConfig | null>>({
    single: null,
    business: null,
  });

  const [promoInput, setPromoInput] = useState<string>("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(
    booking.promoCode ?? null,
  );
  const [appliedViaLink, setAppliedViaLink] = useState<boolean>(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoValidating, setPromoValidating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const leadEmail = booking.attendees?.find((a) => a.isLead)?.workEmail ?? null;

  const [hearAboutUs, setHearAboutUs] = useState<string>(
    ((booking as unknown as Record<string, unknown>).hearAboutUs as string) ?? "",
  );
  const [hearOptions, setHearOptions] = useState<string[]>(FALLBACK_HEAR_OPTIONS);
  const hauFetched = useRef(false);

  const queryClient = useQueryClient();

  const { data: allTiers = [] } = useListDiscountTiers();

  // Pricing fetch: trailing-debounced + abortable. We tag every request with
  // a monotonically-increasing reqId and only commit the response when it
  // matches the latest request — this drops out-of-order responses caused by
  // rapid quantity changes (which would otherwise leave the order summary
  // showing a price for the wrong quantity).
  const [currentPricing, setCurrentPricing] = useState<PricingBreakdown | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const pricingReqIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/passes/inventory")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setInventory(data))
      .catch(() => {});
    fetch("/api/passes/config")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setPassConfig(data))
      .catch(() => {});
    if (!hauFetched.current) {
      hauFetched.current = true;
      fetch("/api/hear-about-us-options")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { label: string }[] | null) => {
          if (Array.isArray(data) && data.length > 0) {
            setHearOptions(data.map((o) => o.label));
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const reqId = ++pricingReqIdRef.current;
    const ac = new AbortController();
    setPricingLoading(true);
    const timer = setTimeout(() => {
      calculatePricing(
        { passType: selectedPass, quantity, promoCode: appliedPromoCode ?? undefined },
        { signal: ac.signal },
      )
        .then((data) => {
          // Drop the response if a newer request has been issued in the meantime
          if (reqId === pricingReqIdRef.current) {
            setCurrentPricing(data);
            setPricingLoading(false);
          }
        })
        .catch(() => {
          // Aborted or transient error — next debounced call will retry.
          // Only clear the loading flag if this was the latest request.
          if (reqId === pricingReqIdRef.current) setPricingLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [selectedPass, quantity, appliedPromoCode]);

  // Complimentary codes are capped by pass count, not booking count. When
  // the requested quantity exceeds the passes remaining on the comp code, the
  // server returns the code as applied but does not zero out the price — the
  // user must either reduce their quantity or remove the code before they
  // can continue.
  const compRemaining =
    currentPricing?.promoDiscountType === "complimentary"
      ? (currentPricing.promoRemainingSeats ?? null)
      : null;
  const compShortfall = compRemaining !== null && compRemaining < quantity;
  const handleReduceToCompCap = () => {
    if (compRemaining !== null && compRemaining > 0) setQuantity(compRemaining);
  };

  const validatePromo = async (
    codeToValidate: string,
  ): Promise<{ ok: boolean; code?: string; error?: string }> => {
    try {
      const res = await customFetch(`/api/promo-codes/validate`, {
        method: "POST",
        body: JSON.stringify({
          code: codeToValidate,
          passType: selectedPass,
          quantity,
          leadEmail: leadEmail ?? undefined,
        }),
      });
      const data = res as {
        valid?: boolean;
        error?: string;
        code?: string;
        remainingSeats?: number | null;
      } | null;
      if (data?.valid && data?.code) return { ok: true, code: data.code };
      return {
        ok: false,
        error: typeof data?.error === "string" ? data.error : "Invalid promo code",
      };
    } catch (e: unknown) {
      const err = e as Record<string, unknown> | null;
      const apiMsg =
        err?.data && typeof (err.data as Record<string, unknown>)?.error === "string"
          ? ((err.data as Record<string, unknown>).error as string)
          : null;
      const fallbackMsg = typeof err?.message === "string" ? err.message : null;
      return { ok: false, error: apiMsg || fallbackMsg || "Invalid or expired promo code" };
    }
  };

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoValidating(true);
    setPromoError(null);
    const result = await validatePromo(code);
    setPromoValidating(false);
    if (result.ok && result.code) {
      setAppliedPromoCode(result.code);
      setAppliedViaLink(false);
      setPromoInput("");
    } else {
      setPromoError(result.error ?? "Invalid promo code");
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromoCode(null);
    setAppliedViaLink(false);
    setPromoInput("");
    setPromoError(null);
  };

  // Auto-apply ?promo=CODE from URL on mount (and re-run on quantity/pass change so
  // a refresh re-applies it, but never overrides a manually-applied code).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlCode = new URLSearchParams(window.location.search).get("promo");
    if (!urlCode) return;
    const normalised = urlCode.trim().toUpperCase();
    if (!normalised) return;
    if (appliedPromoCode === normalised) return;
    if (appliedPromoCode && !appliedViaLink) return; // user has applied a different code manually
    let cancelled = false;
    (async () => {
      const result = await validatePromo(normalised);
      if (cancelled) return;
      if (result.ok && result.code) {
        setAppliedPromoCode(result.code);
        setAppliedViaLink(true);
        setPromoError(null);
      } else {
        setAppliedPromoCode(null);
        setAppliedViaLink(false);
        setPromoError(result.error ?? "Invalid promo code");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPass, quantity, leadEmail]);

  const savePassSelection = async (currentStep: number) => {
    await updateBooking.mutateAsync({
      id: booking.id,
      data: {
        passType: selectedPass as "single" | "business",
        quantity,
        promoCode: appliedPromoCode ?? undefined,
        hearAboutUs: hearAboutUs || undefined,
        currentStep,
      } as Parameters<typeof updateBooking.mutateAsync>[0]["data"],
    });
    queryClient.invalidateQueries({ queryKey: ["booking"] });
  };

  const handleContinue = async () => {
    setSaveError(null);
    try {
      await savePassSelection(3);
      onAdvance?.(3);
    } catch {
      setSaveError("We could not save your pass selection. Please try again.");
    }
  };

  const handleSaveAndReturn = async () => {
    await savePassSelection(2);
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
  const singleDiscountPct =
    singleOriginalPrice > singleCurrentPrice
      ? Math.round(((singleOriginalPrice - singleCurrentPrice) / singleOriginalPrice) * 100)
      : null;
  const singleBenefits =
    singleCfg && singleCfg.benefits.length > 0 ? singleCfg.benefits : DEFAULT_SINGLE_BENEFITS;

  const businessCurrentPrice = businessCfg ? parseFloat(businessCfg.currentPrice) : 599;
  const businessOriginalPrice = businessCfg ? parseFloat(businessCfg.originalPrice) : 999;
  const businessPeriodName = businessCfg?.pricingPeriodName ?? "Early Bird";
  const businessDiscountPct =
    businessOriginalPrice > businessCurrentPrice
      ? Math.round(((businessOriginalPrice - businessCurrentPrice) / businessOriginalPrice) * 100)
      : null;
  const businessBenefits =
    businessCfg && businessCfg.benefits.length > 0 ? businessCfg.benefits : DEFAULT_SINGLE_BENEFITS;
  const businessExtraBenefits =
    businessCfg && businessCfg.extraBenefits.length > 0
      ? businessCfg.extraBenefits
      : DEFAULT_BUSINESS_EXTRA_BENEFITS;
  const audienceLabel = isVendor ? "Commercial attendees" : "Employer-side attendees";
  const passLabel = isVendor ? "Business Pass" : "People & Workforce Pass";
  const unitLabel = "pass";

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Select your pass</h1>
        <p className="text-lg text-muted-foreground">
          {isVendor
            ? "For commercial attendees joining as delegates to understand the market, hear the content and build relevant conversations."
            : "For employer-side HR, People, Workforce, Data, Analytics and business-facing people teams. Group discounts are included in the total."}
        </p>
      </div>

      <div className="checkout-metric-strip">
        <div className="checkout-metric">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Booking type
          </p>
          <p className="text-lg font-bold mt-1">{audienceLabel}</p>
        </div>
        <div className="checkout-metric">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Selected pass
          </p>
          <p className="text-lg font-bold mt-1">
            {quantity} {unitLabel}
            {quantity !== 1 ? "s" : ""}
          </p>
          <p className="text-sm text-muted-foreground">{passLabel}</p>
        </div>
        <div className="checkout-metric">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Current total
          </p>
          <p className="text-lg font-bold mt-1">
            {currentPricing ? `£${currentPricing.total.toFixed(2)}` : "Calculating"}
          </p>
          <p className="text-sm text-muted-foreground">Including VAT</p>
        </div>
      </div>

      {/* HR: Single pass with quantity picker */}
      {isHR && (
        <Card className="relative overflow-hidden rounded-md border-2 border-primary bg-white p-0 shadow-sm">
          {/* ── Header band ── */}
          <div className="px-6 md:px-8 py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-semibold">
                HR Analytics Summit | 3 Sep 2026, London
              </p>
              <h3 className="text-2xl font-bold text-primary font-display leading-tight">
                People & Workforce Pass
              </h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                People & Workforce Pass selected
              </span>
              <InventoryBadge remaining={inventory.single} />
              <div className="text-right">
                <div className="flex items-baseline gap-2 justify-end flex-wrap">
                  <span className="text-3xl font-bold text-foreground">
                    £{singleCurrentPrice.toFixed(0)}
                  </span>
                  {singleOriginalPrice > singleCurrentPrice && (
                    <span className="text-sm text-muted-foreground line-through">
                      £{singleOriginalPrice.toFixed(0)}
                    </span>
                  )}
                  {singleDiscountPct !== null && (
                    <span className="inline-block rounded-md border border-primary/20 bg-primary px-3 py-1 text-xs font-bold text-white shadow-sm">
                      {singleDiscountPct}% off
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Per pass, ex VAT | {singlePeriodName}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start">
            {/* ── Left column: Benefits ── */}
            <div className="flex-1 p-6 md:p-8">
              {/* Benefits grid */}
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                What's included
              </p>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                This pass is not valid for vendors, consultants, recruiters, agencies or commercial
                service providers.
              </p>
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
                How many passes?
              </p>

              {/* 3 passes shortcut */}
              <button
                type="button"
                onClick={() => setQuantity(3)}
                className={`w-full flex items-center justify-between gap-2 rounded-md border px-4 py-3 text-sm font-bold transition-colors ${
                  quantity === 3
                    ? "border-primary bg-primary text-white shadow-sm"
                    : "border-border bg-white text-foreground hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 shrink-0" />3 passes, Most Popular
                </span>
                <Check
                  className={`w-4 h-4 shrink-0 transition-opacity ${quantity === 3 ? "opacity-100" : "opacity-0"}`}
                />
              </button>

              {/* Custom stepper */}
              <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-white">
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease pass quantity"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div
                  className="flex-1 border-x border-border py-2.5 text-center text-2xl font-bold text-foreground"
                  aria-live="polite"
                  aria-label={`${quantity} passes selected`}
                >
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                  disabled={quantity >= 20}
                  aria-label="Increase pass quantity"
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
                    unitLabel="pass"
                  />
                </AnimatePresence>
              </div>

              {/* Tier table */}
              <div className="space-y-1.5 text-xs">
                {hrTierRows.map(({ key, label, note, active, isSpecial }) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-all ${
                      active
                        ? "border-primary/40 bg-white text-foreground shadow-sm ring-1 ring-primary/10"
                        : "border-primary/10 bg-white/70 text-muted-foreground"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <span>{label}</span>
                      {active && (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                          Current
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-right ${active || isSpecial ? "font-bold text-primary" : ""}`}
                    >
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
        <Card className="relative overflow-hidden rounded-md border-2 border-primary bg-white p-0 shadow-sm">
          {/* ── Header band ── */}
          <div className="px-6 md:px-8 py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1 font-semibold">
                HR Analytics Summit | 3 Sep 2026 | Commercial attendees
              </p>
              <h3 className="text-2xl font-bold text-primary font-display leading-tight">
                Business Pass
              </h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                Business Pass selected
              </span>
              <InventoryBadge remaining={inventory.business} />
              <div className="text-right">
                <div className="flex items-baseline gap-2 justify-end flex-wrap">
                  <span className="text-3xl font-bold text-foreground">
                    £{businessCurrentPrice.toFixed(0)}
                  </span>
                  {businessOriginalPrice > businessCurrentPrice && (
                    <span className="text-sm text-muted-foreground line-through">
                      £{businessOriginalPrice.toFixed(0)}
                    </span>
                  )}
                  {businessDiscountPct !== null && (
                    <span className="inline-block rounded-md border border-primary/20 bg-primary px-3 py-1 text-xs font-bold text-white shadow-sm">
                      {businessDiscountPct}% off
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Per pass, ex VAT | {businessPeriodName}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start">
            {/* ── Left column: Benefits ── */}
            <div className="flex-1 p-6 md:p-8">
              {/* Standard benefits */}
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                What's included
              </p>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                This is an attendee pass, not a sponsorship package. Speaking and sponsor visibility
                are handled separately.
              </p>
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
                  <p className="text-xs font-bold uppercase tracking-widest text-gold mb-2">
                    Exclusive to Business Pass
                  </p>
                  {businessExtraBenefits.map((b) => (
                    <div
                      key={b}
                      className="flex items-start gap-2 text-sm font-semibold border-l-2 border-gold pl-2"
                    >
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
            <div className="md:w-72 shrink-0 p-6 bg-primary/5 space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                How many passes?
              </p>

              {/* Custom stepper */}
              <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-white">
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease pass quantity"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div
                  className="flex-1 border-x border-border py-2.5 text-center text-2xl font-bold text-foreground"
                  aria-live="polite"
                  aria-label={`${quantity} passes selected`}
                >
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
                  onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                  disabled={quantity >= 10}
                  aria-label="Increase pass quantity"
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
              <div className="space-y-1.5 text-xs">
                {businessTierRows.map(({ key, label, note, active }) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-all ${
                      active
                        ? "border-primary/40 bg-white text-foreground shadow-sm ring-1 ring-primary/10"
                        : "border-primary/10 bg-white/70 text-muted-foreground"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <span>{label}</span>
                      {active && (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                          Current
                        </span>
                      )}
                    </span>
                    <span className={`text-right ${active ? "font-bold text-primary" : ""}`}>
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
      {/* ── Order Summary ── */}
      <div className="checkout-card flex flex-col justify-between gap-0 overflow-hidden md:flex-row md:items-start md:gap-8">
        {/* Left: selection summary */}
        <div className="flex-1 p-6 md:p-8 space-y-1">
          <h2 className="text-xl font-bold">
            {quantity} pass{quantity !== 1 ? "es" : ""} selected
          </h2>
          {discountLabel && !isMostPopular && (
            <p className="text-sm font-semibold text-secondary">
              {discountLabel} group discount applied
            </p>
          )}
          {isMostPopular && (
            <p className="text-sm font-semibold text-secondary">Most popular choice for teams</p>
          )}
          <p className="text-sm text-muted-foreground pt-1">
            You'll add attendee details in the next step.
          </p>

          {/* How did you hear about us */}
          <div className="pt-4">
            <div className="space-y-2 rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                How did you hear about the event?
              </p>
              <select
                value={hearAboutUs}
                onChange={(e) => setHearAboutUs(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground"
              >
                <option value="">Select an option...</option>
                {hearOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Promo code input */}
          <div className="pt-4 space-y-2">
            {appliedPromoCode ? (
              <>
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
                  <Tag className="w-4 h-4 shrink-0" />
                  <span className="flex-1">
                    Code <span className="font-mono">{appliedPromoCode}</span> applied
                    {appliedViaLink && (
                      <span className="ml-2 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                        Applied via link
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="ml-auto text-primary transition-colors hover:text-primary/80"
                    aria-label="Remove promo code"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {compShortfall && compRemaining !== null && (
                  <CompShortfallPrompt
                    remaining={compRemaining}
                    quantity={quantity}
                    onReduce={handleReduceToCompCap}
                    onRemove={handleRemovePromo}
                  />
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Promo Code
                </p>
                <div className="flex gap-2">
                  <Input
                    className="h-10 uppercase bg-white text-sm font-mono"
                    placeholder="Enter code"
                    value={promoInput}
                    onChange={(e) => {
                      setPromoInput(e.target.value.toUpperCase());
                      setPromoError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleApplyPromo()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 border-border shrink-0"
                    onClick={handleApplyPromo}
                    disabled={promoValidating || !promoInput.trim()}
                  >
                    {promoValidating ? "Checking..." : "Apply"}
                  </Button>
                </div>
                {promoError && <p className="text-xs text-red-600 font-medium">{promoError}</p>}
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
                    ? `${quantity} x Business Pass`
                    : `${quantity} x People & Workforce Pass`}
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
                  className="-mx-2 mt-1 flex items-center justify-between rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-white"
                >
                  <span className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 shrink-0" />
                    You're saving
                  </span>
                  <span className="text-lg font-bold">
                    £{currentPricing.savedAmount.toFixed(2)}
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
      {saveError && (
        <div className="text-sm text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-3">
          {saveError}
        </div>
      )}

      <div className="grid gap-3 border-t border-border pt-6 md:grid-cols-[auto_minmax(260px,1fr)_minmax(260px,320px)] md:items-start">
        <Button
          variant="outline"
          size="lg"
          className="checkout-secondary-action order-3 h-14 w-full px-8 text-lg md:order-1 md:w-auto"
          onClick={async () => {
            await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 1 } });
            queryClient.invalidateQueries({ queryKey: ["booking"] });
          }}
          disabled={updateBooking.isPending}
        >
          Back
        </Button>
        <SaveAndReturnButton
          onSave={handleSaveAndReturn}
          disabled={pricingLoading || !booking.id || compShortfall || updateBooking.isPending}
          className="order-2 items-stretch md:order-2 md:items-center"
          buttonClassName="h-14 w-full md:w-auto md:min-w-[260px]"
        />
        <Button
          size="lg"
          className="checkout-primary-action order-1 h-14 w-full px-10 text-lg md:order-3"
          onClick={handleContinue}
          disabled={pricingLoading || !booking.id || compShortfall || updateBooking.isPending}
        >
          Continue to Attendees
        </Button>
      </div>
    </div>
  );
}
