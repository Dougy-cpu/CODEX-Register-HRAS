import { useState, useEffect } from "react";
import { useUpdateBooking, useCalculatePricing, type PricingRequestPassType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Minus, Plus, Users, Flame, AlertCircle } from "lucide-react";
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

function getHRDiscountLabel(qty: number): string | null {
  if (qty >= 12) return "20% off";
  if (qty >= 8) return "15% off";
  if (qty >= 4) return "10% off";
  if (qty === 3) return "Most Popular";
  return null;
}

function getBusinessDiscountLabel(qty: number): string | null {
  if (qty >= 5) return "15% off";
  if (qty >= 2) return "10% off";
  return null;
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

  const hrDiscountLabel = getHRDiscountLabel(quantity);
  const businessDiscountLabel = getBusinessDiscountLabel(quantity);

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
            <div className="md:w-64 shrink-0">
              <p className="text-sm font-semibold mb-3">How many tickets?</p>

              {/* 3 tickets shortcut */}
              <button
                type="button"
                onClick={() => setQuantity(3)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-sm border-2 mb-3 text-sm font-semibold transition-all ${
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
              <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden mb-3">
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

              {/* Tier table */}
              <div className="space-y-1 text-xs">
                {[
                  { label: "1–2 tickets", note: "£199/ticket", test: (q: number) => q <= 2 },
                  { label: "3 tickets", note: "Most Popular", highlight: true, test: (q: number) => q === 3 },
                  { label: "4–7 tickets", note: "10% off", test: (q: number) => q >= 4 && q <= 7 },
                  { label: "8–11 tickets", note: "15% off", test: (q: number) => q >= 8 && q <= 11 },
                  { label: "12+ tickets", note: "20% off", test: (q: number) => q >= 12 },
                ].map(({ label, note, highlight, test }) => {
                  const active = test(quantity);
                  return (
                    <div
                      key={label}
                      className={`flex justify-between px-2 py-1 rounded-sm transition-colors ${
                        active
                          ? highlight
                            ? "bg-accent/60 text-foreground font-semibold"
                            : "bg-muted text-foreground font-semibold"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span>{label}</span>
                      <span className={highlight && active ? "text-primary font-bold" : ""}>{note}</span>
                    </div>
                  );
                })}
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
            <div className="md:w-64 shrink-0">
              <p className="text-sm font-semibold mb-3">How many passes?</p>

              {/* Stepper */}
              <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden mb-3">
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

              {/* Business discount tiers */}
              <div className="space-y-1 text-xs mb-3">
                {[
                  { label: "1 pass", note: "£599/pass", test: (q: number) => q === 1 },
                  { label: "2–4 passes", note: "10% off", test: (q: number) => q >= 2 && q <= 4 },
                  { label: "5–10 passes", note: "15% off", test: (q: number) => q >= 5 },
                ].map(({ label, note, test }) => {
                  const active = test(quantity);
                  return (
                    <div
                      key={label}
                      className={`flex justify-between px-2 py-1 rounded-sm transition-colors ${
                        active ? "bg-muted text-foreground font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      <span>{label}</span>
                      <span>{note}</span>
                    </div>
                  );
                })}
              </div>

              {businessDiscountLabel && (
                <div className="bg-primary/10 border border-primary/20 rounded-sm px-3 py-2 text-sm font-semibold text-primary">
                  {businessDiscountLabel} group discount applied
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
          {isHR && hrDiscountLabel && hrDiscountLabel !== "Most Popular" && (
            <p className="text-sm font-semibold text-primary">{hrDiscountLabel} group discount applied</p>
          )}
          {isHR && quantity === 3 && (
            <p className="text-sm font-semibold text-primary">Most popular choice for teams</p>
          )}
          {isVendor && businessDiscountLabel && (
            <p className="text-sm font-semibold text-primary">{businessDiscountLabel} group discount applied</p>
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
            </div>
          ) : (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-border w-full rounded" />
              <div className="h-4 bg-border w-2/3 rounded" />
              <div className="h-4 bg-border w-full rounded" />
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
