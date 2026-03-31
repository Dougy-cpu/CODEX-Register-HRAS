import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useUpdateBooking, useCalculatePricing, type PricingRequestPassType } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check } from "lucide-react";

interface Step2PassesProps {
  booking: any;
}

export default function Step2Passes({ booking }: Step2PassesProps) {
  const updateBooking = useUpdateBooking();
  const [selectedPass, setSelectedPass] = useState<PricingRequestPassType>(
    (booking.passType as PricingRequestPassType) || "single"
  );
  const [quantity, setQuantity] = useState<number>(booking.quantity || 1);

  const calculatePricingMutation = useCalculatePricing();

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: {
        passType: selectedPass,
        quantity: quantity,
      }
    });
  }, [selectedPass, quantity]);

  const currentPricing = calculatePricingMutation.data;

  const handleContinue = async () => {
    await updateBooking.mutateAsync({
      id: booking.id,
      data: {
        passType: selectedPass as any,
        quantity: quantity,
        currentStep: 3
      }
    });
    window.location.reload();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Select your pass</h1>
        <p className="text-lg text-muted-foreground">Choose the pass that best fits your needs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="mt-4 mb-6">
            <h3 className="text-2xl font-bold mb-2">Single Pass</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">£199</span>
              <span className="text-sm text-muted-foreground line-through">£429</span>
            </div>
            <p className="text-sm text-primary font-bold mt-1">Save £230</p>
            <p className="text-sm text-muted-foreground mt-1">Ex VAT</p>
          </div>
          <div className="space-y-3">
            {[
              "Conference Sessions", "Networking Sessions", "Happy Hour with Entertainment", 
              "Exhibition Hall", "Award-winning Food & Drink", "On-Demand Recordings",
              "Additional Content Access", "Presentation Slides", "Post-Event Content"
            ].map(benefit => (
              <div key={benefit} className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>{benefit}</span>
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
          <div className="mt-4 mb-6">
            <h3 className="text-2xl font-bold mb-2">Team Pass</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">£499</span>
              <span className="text-sm text-muted-foreground line-through">£1,200</span>
            </div>
            <p className="text-sm text-primary font-bold mt-1">Save £701</p>
            <p className="text-sm text-muted-foreground mt-1">Includes 3 passes (Ex VAT)</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm font-bold">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>Everything in Single Pass × 3 attendees</span>
            </div>
          </div>
        </Card>

        {/* Business Pass */}
        <Card 
          className={`relative p-6 cursor-pointer border-2 transition-all ${selectedPass === "business" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
          onClick={() => { setSelectedPass("business"); setQuantity(1); }}
        >
          <div className="mt-4 mb-6">
            <h3 className="text-2xl font-bold mb-2">Business Pass</h3>
            <p className="text-sm text-muted-foreground mb-2">For Consultants & Vendors</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">£599</span>
              <span className="text-sm text-muted-foreground line-through">£999</span>
            </div>
            <p className="text-sm text-primary font-bold mt-1">Save £400</p>
            <p className="text-sm text-muted-foreground mt-1">Ex VAT</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>All Single Pass benefits</span>
            </div>
            <div className="flex items-start gap-2 text-sm font-bold">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>Attendee Report (exclusive)</span>
            </div>
            <div className="flex items-start gap-2 text-sm font-bold">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>Company Branding (exclusive)</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="bg-white p-6 md:p-8 border border-border flex flex-col md:flex-row md:items-start justify-between gap-8">
        <div className="space-y-4">
          <h2 className="text-xl font-bold">How many people are attending?</h2>
          <div className="w-48">
            <Select 
              value={quantity.toString()} 
              onValueChange={(val) => setQuantity(parseInt(val, 10))}
              disabled={selectedPass === "team"} // Team pass implies fixed size or maybe multiples? Let's just allow adjusting for single/business
            >
              <SelectTrigger className="h-12 bg-white">
                <SelectValue placeholder="Select quantity" />
              </SelectTrigger>
              <SelectContent>
                {selectedPass === "team" ? (
                  <SelectItem value="3">3 attendees</SelectItem>
                ) : (
                  Array.from({ length: 10 }, (_, i) => i + 1).map(num => (
                    <SelectItem key={num} value={num.toString()}>{num} attendee{num > 1 ? 's' : ''}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {quantity > 1 && selectedPass !== "team" && (
            <p className="text-sm text-muted-foreground">Group discounts will be automatically applied.</p>
          )}
        </div>

        <div className="bg-muted p-6 min-w-[300px]">
          <h3 className="text-lg font-bold mb-4">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>{quantity} × {selectedPass === "single" ? "Single Pass" : selectedPass === "team" ? "Team Pass" : "Business Pass"}</span>
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
            window.location.reload();
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
