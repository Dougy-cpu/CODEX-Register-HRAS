import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetBookingBySession, useCreateBooking, useUpdateBooking, customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";

// Hooks
function useBookingSession() {
  const [sessionToken, setSessionToken] = useState<string>("");

  useEffect(() => {
    let token = sessionStorage.getItem("booking_session");
    if (!token) {
      token = uuidv4();
      sessionStorage.setItem("booking_session", token);
    }
    setSessionToken(token);
  }, []);

  return sessionToken;
}

// Components
import Step1Lead from "./Step1Lead";
import Step2Passes from "./Step2Passes";
import Step3Attendees from "./Step3Attendees";
import Step4Payment from "./Step4Payment";
import Confirmation from "./Confirmation";
import CheckoutLayout from "@/components/layout/CheckoutLayout";

const STRIPE_RETURN_PARAM = "session_id";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

export default function CheckoutFlow() {
  const sessionToken = useBookingSession();
  const queryClient = useQueryClient();

  const isStripeReturn = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has(STRIPE_RETURN_PARAM);

  const [pollingForPayment, setPollingForPayment] = useState(isStripeReturn);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollStartRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: booking, isLoading } = useGetBookingBySession(sessionToken, {
    query: {
      queryKey: ["booking", sessionToken],
      enabled: !!sessionToken,
    }
  });

  useEffect(() => {
    if (!pollingForPayment || !sessionToken) return;

    const stripeSessionId = new URLSearchParams(window.location.search).get(STRIPE_RETURN_PARAM);

    pollStartRef.current = Date.now();

    const tryConfirmCardPayment = async () => {
      if (stripeSessionId && booking?.id && booking.status !== "paid" && booking.status !== "invoiced") {
        try {
          await customFetch("/api/stripe/confirm-card-payment", {
            method: "POST",
            body: JSON.stringify({ bookingId: booking.id, sessionId: stripeSessionId }),
          });
        } catch {
          // Fallback to polling if confirm fails
        }
      }
    };

    tryConfirmCardPayment().then(() => {
      queryClient.invalidateQueries({ queryKey: ["booking", sessionToken] });
    });

    pollIntervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - (pollStartRef.current ?? 0);
      if (elapsed >= POLL_TIMEOUT_MS) {
        clearInterval(pollIntervalRef.current!);
        setPollingForPayment(false);
        setPollTimedOut(true);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["booking", sessionToken] });
      const cached = queryClient.getQueryData<typeof booking>(["booking", sessionToken]);
      if (cached?.status === "paid" || cached?.status === "invoiced") {
        clearInterval(pollIntervalRef.current!);
        setPollingForPayment(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingForPayment, sessionToken, booking?.id]);

  useEffect(() => {
    if (pollingForPayment && (booking?.status === "paid" || booking?.status === "invoiced")) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setPollingForPayment(false);
    }
  }, [booking?.status, pollingForPayment]);

  if (isLoading && !booking) {
    return (
      <CheckoutLayout>
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </CheckoutLayout>
    );
  }

  if (pollingForPayment) {
    return (
      <CheckoutLayout currentStep={5}>
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <div>
            <p className="text-2xl font-bold mb-2">Confirming your payment&hellip;</p>
            <p className="text-muted-foreground">Please wait while we finalise your registration.</p>
          </div>
        </div>
      </CheckoutLayout>
    );
  }

  if (pollTimedOut && booking?.status !== "paid") {
    return (
      <CheckoutLayout currentStep={4}>
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <p className="text-2xl font-bold mb-2">Payment confirmation is taking longer than expected.</p>
          <p className="text-muted-foreground">
            If you completed payment, your registration will be confirmed shortly and you'll receive a confirmation email.
            You can safely close this page.
          </p>
        </div>
      </CheckoutLayout>
    );
  }

  const currentStep = booking?.currentStep || 1;

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1Lead sessionToken={sessionToken} booking={booking} />;
      case 2:
        return <Step2Passes booking={booking!} />;
      case 3:
        return <Step3Attendees booking={booking!} />;
      case 4:
        return <Step4Payment booking={booking!} />;
      case 5:
        return <Confirmation booking={booking!} />;
      default:
        return <Step1Lead sessionToken={sessionToken} booking={booking} />;
    }
  };

  return (
    <CheckoutLayout currentStep={currentStep}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>
    </CheckoutLayout>
  );
}
