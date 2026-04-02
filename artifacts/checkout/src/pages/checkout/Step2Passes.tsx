import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useUpdateBooking, useCalculatePricing, useListDiscountTiers, type PricingRequestPassType, type DiscountTier } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Minus, Plus, Users, Flame, AlertCircle, TrendingUp } from "lucide-react";
import type { BookingWithAttendees } from "@/types/booking";

interface Step2PassesProps {
  booking: BookingWithAttendees;
}

const SINGLE_BENEFITS = [
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

const BUSINESS_EXTRA_BENEFITS = [
  "Exclusive Attendee Report",
  "Company Branding at the Summit",
];

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
    const savingPerTicket = Math.round(pricePerTicket * tier.discountPercent / 100);
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
    const savingPerPass = Math.round(pricePerPass * tier.discountPercent / 100);
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
  pricePerUnit: number;
  unitLabel: string;
}

function UpsellNudge({ tiers, passType, quantity, pricePerUnit, unitLabel }: UpsellNudgeProps) {
  const nextTier = getNextTier(tiers, passType, quantity);
  if (!nextTier) return null;

  const needed = nextTier.minQuantity - quantity;
  if (needed > 3) return null;

  const currentTier = getActiveTier(tiers, passType, quantity);
  const currentDiscountPct = currentTier?.discountPercent ?? 0;
  const uplift = Math.round(quantity * pricePerUnit * (nextTier.discountPercent - currentDiscountPct) / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-sm px-3 py-2.5 text-xs text-amber-900"
    >
      <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
      <span>
        <span className="font-bold">Add {needed} more {unitLabel}{needed > 1 ? "s" : ""}</span> to unlock{" "}
        <span className="font-bold">{nextTier.discountPercent}% off</span>
        {uplift > 0 && (
          <span> — save an extra <span className="font-bold">£{uplift}</span> on your order</span>
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

  const calculatePricingMutation = useCalculatePricing();
  const queryClient = useQueryClient();

  const { data: allTiers = [] } = useListDiscountTiers();

  useEffect(() => {
    fetch("/api/passes/inventory")
      .then(res => res.ok ? res.json() : {})
      .then(data => setInventory(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: { passType: selectedPass, quantity },
    });
  }, [selectedPass, quantity]);

  const currentPricing = calculatePricingMutation.data;

  const handleContinue = async () => {
    await updateBooking.mutateAsync({
      id: booking.id,
      data: { passType: selectedPass as "single" | "business", quantity, currentStep: 3 },
    });
    queryClient.invalidateQueries({ queryKey: ["booking"] });
  };

  const activeTier = getActiveTier(allTiers, selectedPass, quantity);
  const discountLabel = activeTier ? `${activeTier.discountPercent}% off` : null;
  const isMostPopular = isHR && quantity === 3;

  const hrTierRows = buildHRTierRows(allTiers, quantity, 199);
  const businessTierRows = buildBusinessTierRows(allTiers, quantity, 599);

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
        <Card className="relative p-6 border-2 border-primary bg-primary/5">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Pass details */}
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-2xl font-bold">HR Professional Pass</h3>
                <InventoryBadge remaining={inventory.single} />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold">£199</span>
                <span className="text-sm text-muted-foreground line-through">£429</span>
                <span className="text-sm font-bold text-primary">54% off</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Per ticket, ex VAT</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SINGLE_BENEFITS.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quantity picker */}
            <div className="md:w-64 shrink-0 space-y-3">
              <p className="text-sm font-semibold">How many tickets?</p>

              {/* 3 tickets shortcut */}
              <button
                type="button"
                onClick={() => setQuantity(3)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-sm border-2 text-sm font-semibold transition-all ${
                  quantity === 3
                    ? "border-primary bg-primary text-white"
                    : "border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  3 tickets — Most Popular
                </span>
                {quantity === 3 && <Check className="w-4 h-4" />}
              </button>

              {/* Stepper */}
              <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden">
                <button
                  type="button"
                  className="flex-none w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center font-bold text-lg py-3">
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                  onClick={() => setQuantity(q => Math.min(20, q + 1))}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Upsell nudge */}
              <UpsellNudge
                tiers={allTiers}
                passType="single"
                quantity={quantity}
                pricePerUnit={199}
                unitLabel="ticket"
              />

              {/* Tier table */}
              <div className="space-y-1 text-xs">
                {hrTierRows.map(({ key, label, note, active, isSpecial }) => (
                  <div
                    key={key}
                    className={`flex justify-between px-2 py-1.5 rounded-sm transition-colors ${
                      active
                        ? isSpecial
                          ? "bg-accent/60 text-foreground font-semibold"
                          : "bg-primary/10 border border-primary/20 text-foreground font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{label}</span>
                    <span className={isSpecial && active ? "text-primary font-bold" : active && !isSpecial ? "text-primary" : ""}>
                      {note}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Vendor: Business Pass with quantity + discounts */}
      {isVendor && (
        <Card className="relative p-6 border-2 border-primary bg-primary/5">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Pass details */}
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="text-2xl font-bold">Business Pass</h3>
                <InventoryBadge remaining={inventory.business} />
              </div>
              <p className="text-sm text-muted-foreground mb-2">For Consultants &amp; Vendors</p>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold">£599</span>
                <span className="text-sm text-muted-foreground line-through">£999</span>
                <span className="text-sm font-bold text-primary">40% off</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Per pass, ex VAT — group discounts apply for multiple</p>

              <div className="space-y-2">
                {SINGLE_BENEFITS.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
                {BUSINESS_EXTRA_BENEFITS.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm font-bold text-primary">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quantity picker */}
            <div className="md:w-64 shrink-0 space-y-3">
              <p className="text-sm font-semibold">How many passes?</p>

              {/* Stepper */}
              <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden">
                <button
                  type="button"
                  className="flex-none w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center font-bold text-lg py-3">
                  {quantity}
                </div>
                <button
                  type="button"
                  className="flex-none w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.min(10, q + 1))}
                  disabled={quantity >= 10}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Upsell nudge */}
              <UpsellNudge
                tiers={allTiers}
                passType="business"
                quantity={quantity}
                pricePerUnit={599}
                unitLabel="pass"
              />

              {/* Business discount tiers */}
              <div className="space-y-1 text-xs">
                {businessTierRows.map(({ key, label, note, active }) => (
                  <div
                    key={key}
                    className={`flex justify-between px-2 py-1.5 rounded-sm transition-colors ${
                      active
                        ? "bg-primary/10 border border-primary/20 text-foreground font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{label}</span>
                    <span className={active ? "text-primary" : ""}>{note}</span>
                  </div>
                ))}
              </div>

              {discountLabel && (
                <div className="bg-primary/10 border border-primary/20 rounded-sm px-3 py-2 text-sm font-semibold text-primary">
                  {discountLabel} group discount applied
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Order Summary */}
      <div className="bg-white p-6 md:p-8 border border-border flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-1">
          <h2 className="text-xl font-bold">
            {quantity} {isHR ? `ticket${quantity !== 1 ? "s" : ""}` : `pass${quantity !== 1 ? "es" : ""}`} selected
          </h2>
          {discountLabel && !isMostPopular && (
            <p className="text-sm font-semibold text-primary">{discountLabel} group discount applied</p>
          )}
          {isMostPopular && (
            <p className="text-sm font-semibold text-primary">Most popular choice for teams</p>
          )}
          <p className="text-sm text-muted-foreground pt-1">
            You'll add attendee details in the next step.
          </p>
        </div>

        <div className="bg-muted p-6 min-w-[280px]">
          <h3 className="text-lg font-bold mb-4">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>
                  {selectedPass === "business"
                    ? `${quantity} × Business Pass`
                    : `${quantity} × HR Professional Pass`}
                </span>
                <span>£{currentPricing.baseSubtotal.toFixed(2)}</span>
              </div>

              {currentPricing.groupDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-primary font-bold">
                  <span>Group Discount ({currentPricing.groupDiscountPercent}%)</span>
                  <span>-£{currentPricing.groupDiscountAmount.toFixed(2)}</span>
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

              <div className="pt-3 border-t border-border flex justify-between font-bold text-xl">
                <span>Total</span>
                <span>£{currentPricing.total.toFixed(2)}</span>
              </div>

              {currentPricing.savedAmount > 0 && (
                <div className="flex justify-between text-sm font-semibold text-primary bg-primary/10 rounded-sm px-3 py-2 -mx-1 mt-1">
                  <span>You're saving</span>
                  <span>£{(currentPricing.savedAmount * 1.2).toFixed(2)}</span>
                </div>
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
