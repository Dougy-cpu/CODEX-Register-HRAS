import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetBookingBySession, useCreateBooking, useUpdateBooking } from "@workspace/api-client-react";
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

export default function CheckoutFlow() {
  const sessionToken = useBookingSession();
  
  const { data: booking, isLoading } = useGetBookingBySession(sessionToken, {
    query: {
      queryKey: ["booking", sessionToken],
      enabled: !!sessionToken,
    }
  });

  const currentStep = booking?.currentStep || 1;

  if (isLoading && !booking) {
    return (
      <CheckoutLayout>
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </CheckoutLayout>
    );
  }

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
