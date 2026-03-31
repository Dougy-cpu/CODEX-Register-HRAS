import { useState, useEffect } from "react";
import { useUpdateBooking, useCalculatePricing, type PricingRequestPassType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Minus, Plus, Flame, AlertCircle } from "lucide-react";
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

function getBusinessDiscountLabel(qty: number): string | null {
  if (qty >= 5) return "15% off";
  if (qty >= 2) return "10% off";
  return null;
}

function InventoryBadge({ remaining }: { remaining: number | null }) {
  if (remaining === null) return null;
  if (remaining <= 5) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-sm">
        <Flame className="w-3 h-3" />
        Only {remaining} left!
      </span>
    );
  }
  if (remaining <= 20) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-sm">
        <AlertCircle className="w-3 h-3" />
        {remaining} remaining — selling fast
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">
      <AlertCircle className="w-3 h-3" />
      {remaining} spots remaining
    </span>
  );
}

export default function Step2Passes({ booking }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const isHR = booking.attendeeType === "hr_professional";
  const isVendor = booking.attendeeType === "consultant_vendor";

  const resolveInitialPass = (): PricingRequestPassType => {
    const stored = booking.passType as PricingRequestPassType;
    if (isVendor) return "business";
    if (isHR && stored === "business") return "single";
    return stored || "single";
  };

  const [selectedPass, setSelectedPass] = useState<PricingRequestPassType>(resolveInitialPass);
  const [quantity, setQuantity] = useState<number>(() => {
    if (booking.passType === "team") return 3;
    return booking.quantity || 1;
  });
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
    const pricingQty = selectedPass === "team" ? 3 : quantity;
    calculatePricingMutation.mutate({ data: { passType: selectedPass, quantity: pricingQty } });
  }, [selectedPass, quantity]);

  const currentPricing = calculatePricingMutation.data;

  const handleSelectPass = (pass: PricingRequestPassType) => {
    setSelectedPass(pass);
    if (pass === "team") setQuantity(3);
    if (pass === "single" && quantity === 3) {
      // keep 3 — valid single quantity, matches "most popular" hint
    }
  };

  const handleContinue = async () => {
    const finalQty = selectedPass === "team" ? 3 : quantity;
    await updateBooking.mutateAsync({
      id: booking.id,
      data: { passType: selectedPass as "single" | "team" | "business", quantity: finalQty, currentStep: 3 },
    });
    queryClient.invalidateQueries({ queryKey: ["booking"] });
  };

  const businessDiscountLabel = getBusinessDiscountLabel(quantity);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Select your pass</h1>
        <p className="text-lg text-muted-foreground">
          {isVendor
            ? "Your Business Pass gives you exclusive access and visibility at the summit."
            : "Choose the option that works best for your team."}
        </p>
      </div>

      {/* ── HR: 2-column grid — Single Pass + Team Pass ── */}
      {isHR && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Single Pass */}
            <Card
              className={`relative p-6 cursor-pointer border-2 transition-all ${
                selectedPass === "single"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => handleSelectPass("single")}
            >
              {/* Badge row */}
              <div className="flex items-center justify-between mb-4">
                <Badge className="bg-accent text-accent-foreground border-none font-bold uppercase tracking-wider text-xs">
                  Most Popular
                </Badge>
                <InventoryBadge remaining={inventory.single} />
              </div>

              <h3 className="text-2xl font-bold mb-3">Single Pass</h3>

              {/* Pricing */}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold">£199</span>
                <span className="text-sm text-muted-foreground line-through">£429</span>
                <span className="text-sm font-bold text-primary">54% off</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Per ticket, ex VAT</p>

              {/* Group discount hint */}
              <div className="bg-muted/60 rounded px-3 py-2 mb-5 text-sm text-muted-foreground">
                Buying for your team?{" "}
                <span className="font-semibold text-foreground">
                  Group discounts apply automatically
                </span>{" "}
                — use the quantity selector below.
              </div>

              {/* Benefits */}
              <div className="space-y-2.5">
                {SINGLE_BENEFITS.map(b => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Team Pass */}
            <Card
              className={`relative p-6 cursor-pointer border-2 transition-all ${
                selectedPass === "team"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => handleSelectPass("team")}
            >
              {/* Badge row */}
              <div className="flex items-center justify-between mb-4">
                <Badge className="bg-accent text-accent-foreground border-none font-bold uppercase tracking-wider text-xs">
                  Best Value
                </Badge>
                <InventoryBadge remaining={inventory.single} />
              </div>

              <h3 className="text-2xl font-bold mb-3">Team Pass</h3>

              {/* Pricing */}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold">£499</span>
                <span className="text-sm text-muted-foreground line-through">£1,287</span>
                <span className="text-sm font-bold text-primary">61% off per ticket</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Total for 3 attendees, ex VAT —{" "}
                <span className="font-semibold text-foreground">£166/ticket</span>
              </p>

              {/* Benefits */}
              <div className="space-y-2.5">
                <div className="flex items-start gap-2 text-sm font-semibold">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>3 attendee seats included</span>
                </div>
                <div className="flex items-start gap-2 text-sm font-semibold text-primary">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>Reduced price vs. buying individually</span>
                </div>
                {SINGLE_BENEFITS.map(b => (
                  <div key={b} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Single pass quantity controls (visible only when Single is selected) */}
          {selectedPass === "single" && (
            <div className="bg-muted/40 border border-border p-5">
              <p className="text-sm font-semibold mb-3">How many tickets?</p>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Stepper */}
                <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden">
                  <button
                    type="button"
                    className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="w-14 text-center font-bold text-lg py-3">
                    {quantity}
                  </div>
                  <button
                    type="button"
                    className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                    onClick={() => setQuantity(q => Math.min(20, q + 1))}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Discount tier pills */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "4–7 tickets", note: "10% off", active: quantity >= 4 && quantity <= 7 },
                    { label: "8–11 tickets", note: "15% off", active: quantity >= 8 && quantity <= 11 },
                    { label: "12+ tickets", note: "20% off", active: quantity >= 12 },
                  ].map(({ label, note, active }) => (
                    <span
                      key={label}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                        active
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-muted-foreground border-border"
                      }`}
                    >
                      {label}: {note}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Vendor: Business Pass only (centred single card) ── */}
      {isVendor && (
        <div className="flex justify-center">
          <Card className="relative p-6 border-2 border-primary bg-primary/5 w-full max-w-xl">
            {/* Badge row */}
            <div className="flex items-center justify-between mb-4">
              <Badge className="bg-accent text-accent-foreground border-none font-bold uppercase tracking-wider text-xs">
                Vendor Pass
              </Badge>
              <InventoryBadge remaining={inventory.business} />
            </div>

            <h3 className="text-2xl font-bold mb-1">Business Pass</h3>
            <p className="text-sm text-muted-foreground mb-3">For Consultants &amp; Vendors</p>

            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-3xl font-bold">£599</span>
              <span className="text-sm text-muted-foreground line-through">£999</span>
              <span className="text-sm font-bold text-primary">40% off</span>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Per pass, ex VAT</p>

            <div className="space-y-2.5">
              {SINGLE_BENEFITS.map(b => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{b}</span>
                </div>
              ))}
              {BUSINESS_EXTRA_BENEFITS.map(b => (
                <div key={b} className="flex items-start gap-2 text-sm font-semibold text-primary">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Quantity + Order Summary ── */}
      <div className="bg-white p-6 md:p-8 border border-border flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-2">
          {/* Vendor quantity controls */}
          {isVendor && (
            <>
              <h2 className="text-xl font-bold">How many Business Passes?</h2>
              <p className="text-sm text-muted-foreground">
                Each pass covers 1 attendee. Group discounts apply for 2+.
              </p>
              <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden w-fit mt-2">
                <button
                  type="button"
                  className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="w-14 text-center font-bold text-lg py-3">
                  {quantity}
                </div>
                <button
                  type="button"
                  className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                  onClick={() => setQuantity(q => Math.min(10, q + 1))}
                  disabled={quantity >= 10}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {/* Business discount tier pills */}
              <div className="flex flex-wrap gap-2 mt-2">
                {[
                  { label: "2–4 passes", note: "10% off", active: quantity >= 2 && quantity <= 4 },
                  { label: "5–10 passes", note: "15% off", active: quantity >= 5 },
                ].map(({ label, note, active }) => (
                  <span
                    key={label}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-muted-foreground border-border"
                    }`}
                  >
                    {label}: {note}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* HR: summary line */}
          {isHR && (
            <div className="space-y-1">
              <h2 className="text-xl font-bold">
                {selectedPass === "team"
                  ? "Team Pass — 3 attendees"
                  : `${quantity} ticket${quantity !== 1 ? "s" : ""} selected`}
              </h2>
              {selectedPass === "single" && quantity >= 4 && (
                <p className="text-sm font-semibold text-primary">
                  {quantity >= 12 ? "20%" : quantity >= 8 ? "15%" : "10%"} group discount applied
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                You'll add attendee details in the next step.
              </p>
            </div>
          )}
        </div>

        {/* Order summary panel */}
        <div className="bg-muted p-6 min-w-[280px]">
          <h3 className="text-lg font-bold mb-4">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>
                  {selectedPass === "team"
                    ? "Team Pass (3 attendees)"
                    : selectedPass === "business"
                    ? `${quantity} × Business Pass`
                    : `${quantity} × Single Pass`}
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
