import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUMMIT_WEBSITE_URL = "https://hranalyticssummit.com";

interface SaveAndReturnButtonProps {
  onSave: () => Promise<void>;
  disabled?: boolean;
  className?: string;
}

export default function SaveAndReturnButton({
  onSave,
  disabled = false,
  className = "",
}: SaveAndReturnButtonProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave();
      window.location.assign(SUMMIT_WEBSITE_URL);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "We could not save your progress. Please check the highlighted fields and try again.",
      );
      setIsSaving(false);
    }
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 px-5 border-border bg-white text-sm sm:text-base"
        onClick={handleClick}
        disabled={disabled || isSaving}
        aria-label="Save progress and return to the HR Analytics Summit website"
      >
        {isSaving ? "Saving..." : "Save and return to HR Analytics Summit"}
        <ArrowUpRight className="w-4 h-4 ml-2 shrink-0" />
      </Button>
      {saveError && (
        <p className="max-w-sm text-center text-xs font-medium text-destructive" role="alert">
          {saveError}
        </p>
      )}
    </div>
  );
}
