import { Button } from "@/components/ui/button";

export interface CompShortfallPromptProps {
  /** Number of complimentary seats remaining on the promo code. */
  remaining: number;
  /** Number of tickets currently selected by the user. */
  quantity: number;
  /** Called when the user accepts the suggestion to reduce quantity to `remaining`. */
  onReduce: () => void;
  /** Called when the user opts to keep their quantity and drop the promo code. */
  onRemove: () => void;
}

/**
 * Amber prompt shown on Step 2 when a complimentary promo code is applied
 * but the requested quantity exceeds the seats remaining on the code. Offers
 * the user two clear paths: reduce the quantity, or keep the quantity and
 * remove the code (paying full price).
 *
 * Pure presentational — owns no state, takes both action callbacks as props
 * so it stays trivially unit-testable.
 */
export function CompShortfallPrompt({
  remaining,
  quantity,
  onReduce,
  onRemove,
}: CompShortfallPromptProps) {
  return (
    <div
      role="alert"
      data-testid="comp-shortfall-prompt"
      className="bg-amber-50 border border-amber-300 px-3 py-2.5 text-sm text-amber-900 space-y-2"
    >
      <p className="font-semibold">
        Only {remaining} complimentary ticket{remaining === 1 ? "" : "s"}{" "}
        {remaining === 1 ? "remains" : "remain"} on this code, but you've selected {quantity}.
      </p>
      <p className="text-xs">
        Reduce your quantity to use the code, or remove the code to keep all {quantity} tickets at
        the standard price.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {remaining > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-amber-400 bg-white hover:bg-amber-100"
            onClick={onReduce}
          >
            Reduce to {remaining} ticket{remaining === 1 ? "" : "s"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 border-amber-400 bg-white hover:bg-amber-100"
          onClick={onRemove}
        >
          Keep my quantity (remove code)
        </Button>
      </div>
    </div>
  );
}
