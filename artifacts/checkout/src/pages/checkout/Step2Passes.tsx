import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useUpdateBooking, useCalculatePricing, type PricingRequestPassType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Minus, Plus, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function getDiscountLabel(qty: number): string | null {
  if (qty >= 12) return "20% off";
  if (qty >= 8) return "15% off";
  if (qty >= 4) return "10% off";
  if (qty === 3) return "Most Popular";
  return null;
}

export default function Step2Passes({ booking }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const isHR = booking.attendeeType === "hr_professional";
  const isVendor = booking.attendeeType === "consultant_vendor";

  const resolveInitialPass = (): PricingRequestPassType => {
    const stored = booking.passType as PricingRequestPassType;
    if (isVendor) return "business";
    // HR no longer has team pass — map it back to single
    if (isHR && (stored === "business" || stored === "team")) return "single";
    return stored || "single";
  };

  const [selectedPass] = useState<PricingRequestPassType>(resolveInitialPass);
  const [quantity, setQuantity] = useState<number>(() => {
    // If they previously had team pass (qty 3), preserve 3; else use stored
    return booking.quantity || 1;
  });

  const calculatePricingMutation = useCalculatePricing();
  const queryClient = useQueryClient();

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

  const discountLabel = getDiscountLabel(quantity);

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
        <div className="space-y-6">
          {/* Pass card — always selected for HR */}
          <Card className="relative p-6 border-2 border-primary bg-primary/5">
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">HR Professional Pass</h3>
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
                <p className="text-sm font-semibold mb-3 text-foreground">How many tickets?</p>

                {/* Most popular shortcut */}
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

                {/* Quantity stepper */}
                <div className="flex items-center border border-border bg-white rounded-sm overflow-hidden mb-3">
                  <button
                    type="button"
                    className="flex-none w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="flex-1 text-center font-bold text-lg leading-none py-3">
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

                {/* Discount tiers callout */}
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "1–2 tickets", note: "£199/ticket" },
                    { label: "3 tickets", note: "Most Popular", highlight: true },
                    { label: "4–7 tickets", note: "10% off per ticket" },
                    { label: "8–11 tickets", note: "15% off per ticket" },
                    { label: "12+ tickets", note: "20% off per ticket" },
                  ].map(({ label, note, highlight }) => {
                    const active =
                      (label === "1–2 tickets" && quantity <= 2) ||
                      (label === "3 tickets" && quantity === 3) ||
                      (label === "4–7 tickets" && quantity >= 4 && quantity <= 7) ||
                      (label === "8–11 tickets" && quantity >= 8 && quantity <= 11) ||
                      (label === "12+ tickets" && quantity >= 12);
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
        </div>
      )}

      {/* Vendor: Business Pass only */}
      {isVendor && (
        <div className="flex justify-center">
          <Card className="relative p-6 border-2 border-primary bg-primary/5 max-w-md w-full">
            <div className="mt-2 mb-4">
              <h3 className="text-2xl font-bold mb-1">Business Pass</h3>
              <p className="text-sm text-muted-foreground mb-3">For Consultants &amp; Vendors</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">£599</span>
                <span className="text-sm text-muted-foreground line-through">£999</span>
                <span className="text-sm font-bold text-primary">40% off</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Per ticket, ex VAT</p>
            </div>

            <div className="space-y-3">
              {SINGLE_BENEFITS.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{b}</span>
                </div>
              ))}
              <div className="flex items-start gap-2 text-sm font-bold text-primary">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>Exclusive Attendee Report</span>
              </div>
              <div className="flex items-start gap-2 text-sm font-bold text-primary">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>Company Branding at the Summit</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Order Summary + Vendor quantity */}
      <div className="bg-white p-6 md:p-8 border border-border flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-4">
          {isVendor && (
            <>
              <h2 className="text-xl font-bold">How many Business Passes?</h2>
              <p className="text-sm text-muted-foreground">
                Each Business Pass covers 1 attendee with enhanced access and company branding.
              </p>
              <div className="w-56">
                <Select
                  value={quantity.toString()}
                  onValueChange={(val) => setQuantity(parseInt(val, 10))}
                >
                  <SelectTrigger className="h-12 bg-white">
                    <SelectValue placeholder="Select quantity" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} pass{num > 1 ? "es" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {isHR && (
            <div className="space-y-1">
              <h2 className="text-xl font-bold">
                {quantity} ticket{quantity !== 1 ? "s" : ""} selected
              </h2>
              {discountLabel && discountLabel !== "Most Popular" && (
                <p className="text-sm font-semibold text-primary">
                  {discountLabel} group discount applied
                </p>
              )}
              {quantity === 3 && (
                <p className="text-sm font-semibold text-primary">
                  Most popular choice for teams
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                You'll add attendee details in the next step.
              </p>
            </div>
          )}
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
