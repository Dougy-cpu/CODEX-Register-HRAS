import { ReactNode } from "react";
import { Check } from "lucide-react";
import logoUrl from "@assets/logo.webp";

interface CheckoutLayoutProps {
  children: ReactNode;
  currentStep?: number;
}

export default function CheckoutLayout({ children, currentStep = 1 }: CheckoutLayoutProps) {
  const steps = ["Your Details", "Select Passes", "Attendee Details", "Payment"];

  return (
    <div className="checkout-shell min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20 selection:text-primary">
      <header className="w-full border-b border-border bg-white sticky top-0 z-10">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
          <img src={logoUrl} alt="HR Analytics Summit" className="h-10 w-auto object-contain" />
          <div className="text-sm font-semibold text-muted-foreground">Registration</div>
        </div>

        {currentStep < 5 && (
          <nav aria-label="Registration progress" className="border-t border-border/70 bg-white">
            <ol className="mx-auto grid max-w-4xl grid-cols-4 px-2 py-3 sm:px-6">
              {steps.map((step, index) => {
                const stepNumber = index + 1;
                const isComplete = stepNumber < currentStep;
                const isCurrent = stepNumber === currentStep;

                return (
                  <li
                    key={step}
                    className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {index < steps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={`absolute left-1/2 top-3.5 h-px w-full ${
                          isComplete ? "bg-primary" : "bg-border"
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-[1] inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                        isComplete
                          ? "border-primary bg-primary text-white"
                          : isCurrent
                            ? "border-primary bg-white text-primary ring-4 ring-primary/10"
                            : "border-border bg-white text-muted-foreground"
                      }`}
                    >
                      {isComplete ? (
                        <>
                          <Check className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Completed</span>
                        </>
                      ) : (
                        stepNumber
                      )}
                    </span>
                    <span
                      className={`min-w-0 text-[11px] font-semibold leading-tight sm:text-xs ${
                        isCurrent
                          ? "text-foreground"
                          : isComplete
                            ? "text-primary"
                            : "text-muted-foreground"
                      }`}
                    >
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 md:py-12">
        {children}
      </main>

      <footer className="w-full border-t border-border mt-auto py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-muted-foreground font-medium">
          HR Analytics Summit, 3 September 2026, 155 Bishopsgate, London
        </div>
      </footer>
    </div>
  );
}
