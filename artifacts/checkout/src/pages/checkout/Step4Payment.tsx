import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useUpdateBooking,
  useCalculatePricing,
  useCreateStripeCheckoutSession,
  useCreateStripeInvoice,
  customFetch,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Check } from "lucide-react";
import type { BookingWithAttendees } from "@/types/booking";

const invoiceSchema = z.object({
  billingName: z.string().min(1, "Billing name is required"),
  billingCompany: z.string().min(1, "Company is required"),
  billingEmail: z.string().email("Valid email is required"),
  billingAddressLine1: z.string().min(1, "Address line 1 is required"),
  billingAddressLine2: z.string().optional(),
  billingTown: z.string().min(1, "Town / City is required"),
  billingRegion: z.string().optional(),
  billingPostcode: z.string().min(1, "Postcode is required"),
  billingCountry: z.string().min(1, "Country is required"),
  billingPhone: z.string().min(1, "Contact number is required"),
  billingVatNumber: z.string().optional(),
  poNumber: z.string().optional(),
});

interface Step4PaymentProps {
  booking: BookingWithAttendees;
}

export default function Step4Payment({ booking }: Step4PaymentProps) {
  const queryClient = useQueryClient();
  const updateBooking = useUpdateBooking();
  const createStripeSession = useCreateStripeCheckoutSession();
  const createInvoice = useCreateStripeInvoice();

  const [paymentMethod, setPaymentMethod] = useState<"card" | "invoice">("card");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isFreeConfirming, setIsFreeConfirming] = useState(false);
  // Set to true just before intentional navigation (Stripe redirect / invoice success)
  // so the beforeunload handler does NOT fire a false incomplete-ping.
  const isSubmittingPaymentRef = useRef(false);

  const calculatePricingMutation = useCalculatePricing();

  useEffect(() => {
    calculatePricingMutation.mutate({
      data: {
        passType: booking.passType,
        quantity: booking.quantity,
        promoCode: booking.promoCode || undefined,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.passType, booking.quantity]);

  // Abandonment detection: fire incomplete-ping when the user leaves without paying.
  // Two triggers: (1) beforeunload via sendBeacon for tab close / navigation away,
  // (2) a 20-minute setTimeout as a fallback for users who stay but then leave.
  // Both are no-ops if the booking has already been paid/invoiced.
  useEffect(() => {
    if (booking.status !== "partial") return;

    const pingUrl = `/api/bookings/${booking.id}/incomplete-ping`;

    const handleBeforeUnload = () => {
      if (isSubmittingPaymentRef.current) return;
      navigator.sendBeacon(pingUrl, "");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    const timer = setTimeout(
      () => {
        void fetch(pingUrl, { method: "POST" });
      },
      20 * 60 * 1000,
    );

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearTimeout(timer);
    };
  }, [booking.id, booking.status]);

  const currentPricing = calculatePricingMutation.data;

  const billingLead =
    booking.attendees?.find((a) => a.isLead && !a.isTbc) ??
    booking.attendees?.find((a) => !a.isTbc);

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      billingName:
        booking.billingName ||
        (billingLead ? `${billingLead.firstName} ${billingLead.lastName}` : ""),
      billingCompany: booking.billingCompany || billingLead?.company || "",
      billingEmail: booking.billingEmail || billingLead?.workEmail || "",
      billingAddressLine1: booking.billingAddressLine1 || "",
      billingAddressLine2: booking.billingAddressLine2 || "",
      billingTown: booking.billingTown || "",
      billingRegion: booking.billingRegion || "",
      billingPostcode: booking.billingPostcode || "",
      billingCountry: booking.billingCountry || "United Kingdom",
      billingPhone: booking.billingPhone || "",
      billingVatNumber: booking.billingVatNumber || "",
      poNumber: booking.poNumber || "",
    },
  });

  const onSubmit = async (data?: z.infer<typeof invoiceSchema>) => {
    setIsProcessing(true);
    setPaymentError(null);
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: {
          paymentMethod,
          ...(paymentMethod === "invoice" && data
            ? {
                billingName: data.billingName,
                billingCompany: data.billingCompany,
                billingEmail: data.billingEmail,
                billingAddressLine1: data.billingAddressLine1,
                billingAddressLine2: data.billingAddressLine2 || null,
                billingTown: data.billingTown,
                billingRegion: data.billingRegion || null,
                billingPostcode: data.billingPostcode,
                billingCountry: data.billingCountry,
                billingPhone: data.billingPhone,
                billingVatNumber: data.billingVatNumber || null,
                poNumber: data.poNumber || null,
              }
            : {}),
        },
      });

      if (paymentMethod === "card") {
        const currentUrl = window.location.origin;
        const session = await createStripeSession.mutateAsync({
          data: {
            bookingId: booking.id,
            successUrl: `${currentUrl}/?session_id={CHECKOUT_SESSION_ID}&step=5`,
            cancelUrl: `${currentUrl}/?step=4`,
          },
        });
        if (session?.url) {
          isSubmittingPaymentRef.current = true;
          window.location.href = session.url;
        } else {
          setPaymentError(
            "No redirect URL received from payment provider. Please try again or contact us.",
          );
          setIsProcessing(false);
        }
      } else {
        isSubmittingPaymentRef.current = true;
        await createInvoice.mutateAsync({
          data: { bookingId: booking.id },
        });
        queryClient.invalidateQueries({ queryKey: ["booking"] });
      }
    } catch (e: any) {
      console.error(e);
      isSubmittingPaymentRef.current = false;
      const message =
        e?.data?.error || e?.message || "Something went wrong. Please try again or contact us.";
      setPaymentError(message);
      setIsProcessing(false);
    }
  };

  const handleConfirmFree = async () => {
    setIsFreeConfirming(true);
    setPaymentError(null);
    try {
      await customFetch(`/api/bookings/${booking.id}/confirm-free`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["booking"] });
    } catch (e: any) {
      const message =
        e?.data?.error || e?.message || "Something went wrong. Please try again or contact us.";
      setPaymentError(message);
      setIsFreeConfirming(false);
    }
  };

  const isFreeBooking = currentPricing !== undefined && currentPricing.total === 0;

  if (isFreeBooking) {
    return (
      <div className="max-w-5xl mx-auto space-y-8 flex flex-col md:flex-row gap-12">
        <div className="flex-1 space-y-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Confirm Registration</h1>
            <p className="text-lg text-muted-foreground">
              Your promo code covers the full cost — no payment needed.
            </p>
          </div>

          <div className="bg-white border border-border p-6 md:p-8 space-y-4">
            <div className="flex items-start gap-3 text-green-800 bg-green-50 border border-green-200 p-4">
              <Check className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Your promo code has been applied</p>
                <p className="text-sm text-green-700 mt-0.5">
                  This booking is completely free. Click the button below to confirm your place at
                  the summit.
                </p>
              </div>
            </div>
          </div>

          {paymentError && (
            <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
              <p className="font-semibold mb-1">Error</p>
              <p>{paymentError}</p>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              size="lg"
              className="px-8 h-14 text-lg border-border"
              onClick={async () => {
                await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 3 } });
                queryClient.invalidateQueries({ queryKey: ["booking"] });
              }}
            >
              Back
            </Button>
            <Button
              size="lg"
              className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none"
              onClick={handleConfirmFree}
              disabled={isFreeConfirming}
            >
              {isFreeConfirming ? "Confirming…" : "Confirm Registration"}
            </Button>
          </div>
        </div>

        <div className="w-full md:w-[380px] shrink-0 space-y-6">
          <div className="bg-muted p-6">
            <h3 className="text-xl font-bold mb-6">Order Summary</h3>
            <div className="space-y-4">
              <div className="flex justify-between text-base">
                <span>
                  {booking.quantity} ×{" "}
                  {booking.passType === "single" ? "Single Pass" : "Business Pass"}
                </span>
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
                <span>£0.00</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 flex flex-col md:flex-row gap-12">
      <div className="flex-1 space-y-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Payment</h1>
          <p className="text-lg text-muted-foreground">Choose your preferred payment method.</p>
        </div>

        <div className="bg-white p-6 md:p-8 border border-border">
          <RadioGroup
            value={paymentMethod}
            onValueChange={(val: "card" | "invoice") => setPaymentMethod(val)}
            className="space-y-4"
          >
            <div
              className={`border-2 p-6 transition-all cursor-pointer ${paymentMethod === "card" ? "border-primary bg-primary/5" : "border-border"}`}
              onClick={() => setPaymentMethod("card")}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="card" />
                <span className="font-bold text-xl">Credit or Debit Card</span>
              </div>
              <p className="ml-7 mt-2 text-muted-foreground">Pay securely now via Stripe.</p>
            </div>

            <div
              className={`border-2 p-6 transition-all cursor-pointer ${paymentMethod === "invoice" ? "border-primary bg-primary/5" : "border-border"}`}
              onClick={() => setPaymentMethod("invoice")}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="invoice" />
                <span className="font-bold text-xl">Pay by Invoice</span>
              </div>
              <p className="ml-7 mt-2 text-muted-foreground">
                We'll email you an invoice to pay by card or bank transfer within 14 days.
              </p>
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
                  name="billingPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchaser Contact Number *</FormLabel>
                      <FormControl>
                        <Input type="tel" {...field} className="h-12 bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billingAddressLine1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address Line 1 *</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-12 bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billingAddressLine2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Address Line 2{" "}
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} className="h-12 bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="billingTown"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Town / City *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="billingRegion"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Region / County{" "}
                          <span className="text-muted-foreground font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="billingPostcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postcode *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="billingCountry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12 bg-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="billingVatNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          VAT Number{" "}
                          <span className="text-muted-foreground font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. GB123456789"
                            className="h-12 bg-white"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="poNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          PO Number{" "}
                          <span className="text-muted-foreground font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Add to appear on the invoice"
                            className="h-12 bg-white"
                            maxLength={30}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-sm p-3 leading-relaxed">
                  <strong>Need a PO number on your invoice?</strong> Enter it above to have it
                  printed on the invoice we issue. You can also add or change the PO number — and
                  update billing details — at any time before payment using the secure self-service
                  link in your confirmation email; we'll re-issue the invoice with the new details
                  automatically.
                </p>
              </form>
            </Form>
          </div>
        )}

        {paymentError && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
            <p className="font-semibold mb-1">Payment error</p>
            <p>{paymentError}</p>
            <p className="mt-2 text-red-700">
              If this continues, please email us at{" "}
              <a href="mailto:info@hranalyticssummit.com" className="underline">
                info@hranalyticssummit.com
              </a>{" "}
              to complete your registration.
            </p>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            size="lg"
            className="px-8 h-14 text-lg border-border"
            onClick={async () => {
              await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 3 } });
              queryClient.invalidateQueries({ queryKey: ["booking"] });
            }}
          >
            Back
          </Button>
          <Button
            size="lg"
            className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none"
            onClick={() =>
              paymentMethod === "invoice"
                ? document
                    .getElementById("invoice-form")
                    ?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }))
                : onSubmit()
            }
            disabled={isProcessing}
          >
            {isProcessing
              ? "Processing..."
              : paymentMethod === "card"
                ? "Proceed to Checkout"
                : "Complete Registration"}
          </Button>
        </div>
      </div>

      <div className="w-full md:w-[380px] shrink-0 space-y-6">
        <div className="bg-muted p-6">
          <h3 className="text-xl font-bold mb-6">Order Summary</h3>
          {currentPricing ? (
            <div className="space-y-4">
              <div className="flex justify-between text-base">
                <span>
                  {booking.quantity} ×{" "}
                  {booking.passType === "single" ? "Single Pass" : "Business Pass"}
                </span>
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
      </div>
    </div>
  );
}
