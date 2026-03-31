import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useUpdateBooking, 
  useCalculatePricing, 
  useValidatePromoCode,
  useCreateStripeCheckoutSession,
  useCreateFreeAgentInvoice
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Check } from "lucide-react";
import type { BookingWithAttendees } from "@/types/booking";

const invoiceSchema = z.object({
  billingName: z.string().min(1, "Billing name is required"),
  billingCompany: z.string().min(1, "Company is required"),
  billingEmail: z.string().email("Valid email is required"),
  billingAddress: z.string().min(1, "Address is required"),
});

interface Step4PaymentProps {
  booking: BookingWithAttendees;
}

export default function Step4Payment({ booking }: Step4PaymentProps) {
  const queryClient = useQueryClient();
  const updateBooking = useUpdateBooking();
  const validatePromoCode = useValidatePromoCode();
  const createStripeSession = useCreateStripeCheckoutSession();
  const createInvoice = useCreateFreeAgentInvoice();

  const [paymentMethod, setPaymentMethod] = useState<"card" | "invoice">("card");
  const [promoCode, setPromoCode] = useState(booking.promoCode || "");
  const [promoError, setPromoError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const calculatePricingMutation = useCalculatePricing();

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: {
        passType: booking.passType,
        quantity: booking.quantity,
        promoCode: promoCode || undefined,
      }
    });
  }, [booking.passType, booking.quantity, promoCode]);

  const currentPricing = calculatePricingMutation.data;

  const handleApplyPromo = async () => {
    if (!promoCode) return;
    try {
      const result = await validatePromoCode.mutateAsync({
        data: {
          code: promoCode,
          passType: booking.passType as "single" | "team" | "business",
          quantity: booking.quantity
        }
      });
      if (!result.valid) {
        setPromoError(result.message || "Invalid promo code");
      } else {
        setPromoError("");
        await updateBooking.mutateAsync({
          id: booking.id,
          data: { promoCode }
        });
      }
    } catch {
      setPromoError("Invalid promo code");
    }
  };

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      billingName: booking.billingName || booking.attendees?.[0]?.firstName + " " + booking.attendees?.[0]?.lastName || "",
      billingCompany: booking.billingCompany || booking.attendees?.[0]?.company || "",
      billingEmail: booking.billingEmail || booking.attendees?.[0]?.workEmail || "",
      billingAddress: booking.billingAddress || "",
    }
  });

  const onSubmit = async (data?: z.infer<typeof invoiceSchema>) => {
    setIsProcessing(true);
    setPaymentError(null);
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: {
          paymentMethod,
          ...(paymentMethod === "invoice" && data ? {
            billingName: data.billingName,
            billingCompany: data.billingCompany,
            billingEmail: data.billingEmail,
            billingAddress: data.billingAddress,
          } : {})
        }
      });

      if (paymentMethod === "card") {
        const currentUrl = window.location.origin;
        const session = await createStripeSession.mutateAsync({
          data: {
            bookingId: booking.id,
            successUrl: `${currentUrl}/?session_id={CHECKOUT_SESSION_ID}&step=5`,
            cancelUrl: `${currentUrl}/?step=4`
          }
        });
        if (session?.url) {
          window.location.href = session.url;
        } else {
          setPaymentError("No redirect URL received from payment provider. Please try again or contact us.");
          setIsProcessing(false);
        }
      } else {
        await createInvoice.mutateAsync({
          data: { bookingId: booking.id }
        });
        queryClient.invalidateQueries({ queryKey: ["booking"] });
      }
    } catch (e: any) {
      console.error(e);
      const message = e?.data?.error || e?.message || "Something went wrong. Please try again or contact us.";
      setPaymentError(message);
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 flex flex-col md:flex-row gap-12">
      <div className="flex-1 space-y-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Payment</h1>
          <p className="text-lg text-muted-foreground">Choose your preferred payment method.</p>
        </div>

        <div className="bg-white p-6 md:p-8 border border-border">
          <RadioGroup value={paymentMethod} onValueChange={(val: "card" | "invoice") => setPaymentMethod(val)} className="space-y-4">
            <div className={`border-2 p-6 transition-all cursor-pointer ${paymentMethod === 'card' ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => setPaymentMethod("card")}>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="card" />
                <span className="font-bold text-xl">Credit or Debit Card</span>
              </div>
              <p className="ml-7 mt-2 text-muted-foreground">Pay securely now via Stripe.</p>
            </div>
            
            <div className={`border-2 p-6 transition-all cursor-pointer ${paymentMethod === 'invoice' ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => setPaymentMethod("invoice")}>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="invoice" />
                <span className="font-bold text-xl">Pay by Invoice</span>
              </div>
              <p className="ml-7 mt-2 text-muted-foreground">We'll email you an invoice to pay via bank transfer within 14 days.</p>
            </div>
          </RadioGroup>
        </div>

        {paymentMethod === "invoice" && (
          <div className="bg-white p-6 md:p-8 border border-border">
            <h2 className="text-2xl font-bold mb-6">Billing Details</h2>
            <Form {...form}>
              <form className="space-y-6" id="invoice-form" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="billingName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Billing Contact Name *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="billingCompany"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="billingEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Email Address *</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} className="h-12 bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billingAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Billing Address *</FormLabel>
                      <FormControl>
                        <textarea {...field} className="w-full min-h-[100px] p-3 border border-border bg-white resize-y rounded-none" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
        )}

        {paymentError && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
            <p className="font-semibold mb-1">Payment error</p>
            <p>{paymentError}</p>
            <p className="mt-2 text-red-700">If this continues, please email us at <a href="mailto:info@hranalyticssummit.com" className="underline">info@hranalyticssummit.com</a> to complete your registration.</p>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button variant="outline" size="lg" className="px-8 h-14 text-lg border-border" onClick={async () => {
            await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 3 } });
            queryClient.invalidateQueries({ queryKey: ["booking"] });
          }}>Back</Button>
          <Button 
            size="lg" 
            className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none" 
            onClick={() => paymentMethod === "invoice" ? document.getElementById("invoice-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })) : onSubmit()}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing..." : paymentMethod === "card" ? "Proceed to Checkout" : "Complete Registration"}
          </Button>
        </div>
      </div>

      <div className="w-full md:w-[380px] shrink-0 space-y-6">
        <div className="bg-muted p-6">
          <h3 className="text-xl font-bold mb-6">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-4">
              <div className="flex justify-between text-base">
                <span>{booking.quantity} × {booking.passType === "single" ? "Single Pass" : booking.passType === "team" ? "Team Pass" : "Business Pass"}</span>
                <span>£{currentPricing.baseSubtotal.toFixed(2)}</span>
              </div>
              
              {currentPricing.groupDiscountAmount > 0 && (
                <div className="flex justify-between text-base text-primary font-bold">
                  <span>Group Discount</span>
                  <span>-£{currentPricing.groupDiscountAmount.toFixed(2)}</span>
                </div>
              )}

              {currentPricing.promoDiscountAmount > 0 && (
                <div className="flex justify-between text-base text-primary font-bold">
                  <span>Promo Code</span>
                  <span>-£{currentPricing.promoDiscountAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-base">
                <span>Subtotal</span>
                <span>£{currentPricing.subtotalAfterDiscounts.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base text-muted-foreground border-b border-border pb-4">
                <span>VAT (20%)</span>
                <span>£{currentPricing.vatAmount.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between font-bold text-2xl pt-2">
                <span>Total</span>
                <span>£{currentPricing.total.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-border w-full rounded"></div>
              <div className="h-4 bg-border w-full rounded"></div>
              <div className="h-4 bg-border w-full rounded"></div>
            </div>
          )}
        </div>

        <div className="bg-white p-6 border border-border">
          <h4 className="font-bold mb-3">Promo Code</h4>
          <div className="flex gap-2">
            <Input 
              value={promoCode} 
              onChange={(e) => setPromoCode(e.target.value)} 
              placeholder="Enter code" 
              className="bg-white rounded-none"
            />
            <Button variant="secondary" onClick={handleApplyPromo} className="rounded-[300px]">Apply</Button>
          </div>
          {promoError && <p className="text-sm text-destructive mt-2">{promoError}</p>}
        </div>
      </div>
    </div>
  );
}
