import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useUpdateBooking, useCalculatePricing, type PricingRequestPassType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check } from "lucide-react";

interface Step2PassesProps {
  booking: any;
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

export default function Step2Passes({ booking }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const isHR = booking.attendeeType === "hr_professional";
  const isVendor = booking.attendeeType === "consultant_vendor";

  // Determine the correct default pass based on attendee type.
  // Step 1 always seeds the booking with passType: "single", so we override
  // here if the stored passType doesn't match what this attendee type can see.
  const resolveInitialPass = (): PricingRequestPassType => {
    const stored = booking.passType as PricingRequestPassType;
    if (isVendor) return "business"; // vendors only see Business Pass
    if (isHR && stored === "business") return "single"; // HR can't have business
    return stored || "single";
  };

  const [selectedPass, setSelectedPass] = useState<PricingRequestPassType>(resolveInitialPass);
  const [quantity, setQuantity] = useState<number>(() => {
    if (isVendor) return 1;
    return booking.quantity || 1;
  });

  const calculatePricingMutation = useCalculatePricing();

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: { passType: selectedPass, quantity },
    });
  }, [selectedPass, quantity]);

  const currentPricing = calculatePricingMutation.data;

  const queryClient = useQueryClient();

  const handleContinue = async () => {
    await updateBooking.mutateAsync({
      id: booking.id,
      data: { passType: selectedPass as "single" | "team" | "business", quantity, currentStep: 3 },
    });
    queryClient.invalidateQueries({ queryKey: ["booking"] });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Select your pass</h1>
        <p className="text-lg text-muted-foreground">
          {isVendor
            ? "Your Business Pass gives you exclusive access and visibility at the summit."
            : "Choose the option that best suits your team."}
        </p>
      </div>

      {/* HR: Single + Team (2-up) */}
      {isHR && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Single Pass */}
          <Card
            className={`relative p-6 cursor-pointer border-2 transition-all ${selectedPass === "single" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            onClick={() => { setSelectedPass("single"); setQuantity(1); }}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-accent text-accent-foreground border-none font-bold uppercase tracking-wider px-3 py-1 text-xs">
                Most Popular
              </Badge>
            </div>

            <div className="mt-4 mb-1">
              <h3 className="text-2xl font-bold mb-3">Single Pass</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">£199</span>
                <span className="text-sm text-muted-foreground line-through">£429</span>
                <span className="text-sm font-bold text-primary">54% off</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Per ticket, ex VAT</p>
            </div>

            <div className="bg-muted/50 rounded px-3 py-2 mb-4 text-sm text-muted-foreground">
              Buying multiple tickets?{" "}
              <span className="font-semibold text-foreground">Group discounts apply automatically</span>{" "}
              — use the quantity selector below.
            </div>

            <div className="space-y-3">
              {SINGLE_BENEFITS.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Team Pass */}
          <Card
            className={`relative p-6 cursor-pointer border-2 transition-all ${selectedPass === "team" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
            onClick={() => { setSelectedPass("team"); setQuantity(3); }}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-accent text-accent-foreground border-none font-bold uppercase tracking-wider px-3 py-1 text-xs">
                Best Value
              </Badge>
            </div>

            <div className="mt-4 mb-4">
              <h3 className="text-2xl font-bold mb-3">Team Pass</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">£499</span>
                <span className="text-sm text-muted-foreground line-through">£1,200</span>
                <span className="text-sm font-bold text-primary">61% off</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Total for 3 attendees, ex VAT &mdash; <span className="font-semibold text-foreground">£166/ticket</span>
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm font-bold">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>3 attendee seats included</span>
              </div>
              <div className="flex items-start gap-2 text-sm font-bold text-primary">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>Reduced price vs. buying individually</span>
              </div>
              {SINGLE_BENEFITS.map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Vendor: Business Pass only (centred single card) */}
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

      {/* Quantity + Order Summary */}
      <div className="bg-white p-6 md:p-8 border border-border flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-4">
          {selectedPass === "single" && (
            <>
              <h2 className="text-xl font-bold">How many tickets?</h2>
              <p className="text-sm text-muted-foreground">
                Group discounts are applied automatically — the more you buy, the more you save.
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
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} ticket{num > 1 ? "s" : ""}
                        {num >= 4 && num < 8 ? " — 10% off" : ""}
                        {num >= 8 && num < 12 ? " — 15% off" : ""}
                        {num >= 12 ? " — 20% off" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {selectedPass === "team" && (
            <>
              <h2 className="text-xl font-bold">Team of 3</h2>
              <p className="text-sm text-muted-foreground">
                The Team Pass covers exactly 3 attendees. You'll add their details in the next step.
              </p>
            </>
          )}

          {selectedPass === "business" && (
            <>
              <h2 className="text-xl font-bold">1 attendee</h2>
              <p className="text-sm text-muted-foreground">
                The Business Pass is for 1 attendee with enhanced access and branding.
              </p>
            </>
          )}
        </div>

        <div className="bg-muted p-6 min-w-[280px]">
          <h3 className="text-lg font-bold mb-4">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>
                  {selectedPass === "team"
                    ? "Team Pass (3 attendees)"
                    : selectedPass === "business"
                    ? "Business Pass"
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
